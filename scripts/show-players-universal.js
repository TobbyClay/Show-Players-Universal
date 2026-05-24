const MODULE_ID = "show-players-universal";
const SOCKET_NAME = `module.${MODULE_ID}`;
const BUTTON_CLASS = "show-players-universal";
const ACTION_ID = "showPlayersUniversal";

class ShowPlayersUniversal {
  static init() {
    this.registerSettings();
    this.patchHeaderHooks();
    this.patchHeaderMethods();
  }

  static ready() {
    game.socket?.on(SOCKET_NAME, data => this.onSocketData(data));
  }

  static registerSettings() {
    game.settings.register(MODULE_ID, "minimumRole", {
      name: "Minimum Role",
      hint: "Users below this role will not see the Show Players sheet button.",
      scope: "world",
      config: true,
      type: Number,
      choices: this.getRoleChoices(),
      default: CONST.USER_ROLES.ASSISTANT,
    });
  }

  static getRoleChoices() {
    const roles = CONST.USER_ROLES;
    return {
      [roles.PLAYER]: "Player",
      [roles.TRUSTED]: "Trusted Player",
      [roles.ASSISTANT]: "Assistant GM",
      [roles.GAMEMASTER]: "Gamemaster",
    };
  }

  static patchHeaderHooks() {
    if (Hooks._showPlayersUniversalPatched) return;
    Hooks._showPlayersUniversalPatched = true;

    const originalCall = Hooks.call.bind(Hooks);
    Hooks.call = (hook, ...args) => {
      this.maybeInjectHeaderControl(hook, args);
      return originalCall(hook, ...args);
    };

    const originalCallAll = Hooks.callAll.bind(Hooks);
    Hooks.callAll = (hook, ...args) => {
      this.maybeInjectHeaderControl(hook, args);
      return originalCallAll(hook, ...args);
    };
  }

  static patchHeaderMethods() {
    this.patchMethod({
      proto: globalThis.Application?.prototype,
      methodName: "_getHeaderButtons",
      mapper: (app, buttons) => this.addLegacyButton(app, buttons),
    });

    this.patchMethod({
      proto: foundry.appv1?.api?.Application?.prototype,
      methodName: "_getHeaderButtons",
      mapper: (app, buttons) => this.addLegacyButton(app, buttons),
    });

    this.patchMethod({
      proto: foundry.applications?.api?.ApplicationV2?.prototype,
      methodName: "_headerControlButtons",
      mapper: (app, controls) => this.addAppV2Control(app, controls),
    });

    this.patchAppV2ClickHandler(foundry.applications?.api?.ApplicationV2?.prototype);
  }

  static patchMethod({proto, methodName, mapper}) {
    if (!proto?.[methodName]) return;

    const patchKey = `_showPlayersUniversal_${methodName}`;
    if (proto[patchKey]) return;
    proto[patchKey] = true;

    const original = proto[methodName];
    proto[methodName] = function (...args) {
      const out = original.apply(this, args);
      mapper(this, out);
      return out;
    };
  }

  static patchAppV2ClickHandler(proto) {
    if (!proto?._onClickAction) return;
    if (proto._showPlayersUniversal_onClickAction) return;
    proto._showPlayersUniversal_onClickAction = true;

    const original = proto._onClickAction;
    proto._onClickAction = function (event, target) {
      if (target?.dataset?.action === ACTION_ID) {
        return ShowPlayersUniversal.handleButtonClick(event, this);
      }

      return original.apply(this, arguments);
    };
  }

  static maybeInjectHeaderControl(hook, args) {
    if (!hook || !Array.isArray(args?.[1])) return;

    if (/^get.+HeaderButtons$/.test(hook)) {
      this.addLegacyButton(args[0], args[1]);
      return;
    }

    if (/^getHeaderControls.+/.test(hook)) this.addAppV2Control(args[0], args[1]);
  }

  static addLegacyButton(app, buttons) {
    if (!Array.isArray(buttons)) return buttons;
    if (!this.canShowForApp(app)) return buttons;
    if (buttons.some(btn => btn?.class === BUTTON_CLASS || btn?.class?.includes?.(BUTTON_CLASS))) return buttons;

    const button = {
      label: "Show Players",
      class: BUTTON_CLASS,
      icon: "fas fa-eye",
      onclick: event => this.handleButtonClick(event, app),
    };

    const closeIndex = buttons.findIndex(btn => btn?.class === "close");
    if (closeIndex >= 0) buttons.splice(closeIndex, 0, button);
    else buttons.push(button);

    return buttons;
  }

  static addAppV2Control(app, controls) {
    if (!Array.isArray(controls)) return controls;
    if (!this.canShowForApp(app)) return controls;
    if (controls.some(control => control?.action === ACTION_ID || control?.class === BUTTON_CLASS)) return controls;

    if (app?.options) {
      app.options.actions ??= {};
      app.options.actions[ACTION_ID] ??= event => this.handleButtonClick(event, app);
    }

    controls.push({
      action: ACTION_ID,
      class: BUTTON_CLASS,
      icon: "fa-solid fa-eye",
      label: "Show Players",
      ownership: "OWNER",
      visible: sheet => this.canShowForApp(sheet || app),
      onClick: event => this.handleButtonClick(event, app),
      onClickAction: function (event) {
        return ShowPlayersUniversal.handleButtonClick(event, this);
      },
    });

    return controls;
  }

  static canShowForApp(app) {
    if (!app) return false;
    if (game.user.role < game.settings.get(MODULE_ID, "minimumRole")) return false;

    const doc = this.getDocumentFromApp(app);
    if (!this.isShowableDocument(doc)) return false;

    return this.isOwner(doc);
  }

  static getDocumentFromApp(app) {
    return app?.document
      || app?.actor
      || app?.item
      || (app?.object?.uuid ? app.object : null);
  }

  static isShowableDocument(doc) {
    if (!doc?.uuid) return false;
    if (!doc?.sheet) return false;
    if (!doc?.testUserPermission) return false;
    return true;
  }

  static isOwner(doc, user = game.user) {
    if (!doc || !user) return false;
    if (user.isGM) return true;
    if (user.id === game.user.id && doc.isOwner) return true;
    return this.testPermission(doc, user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  }

  static canView(doc, user = game.user) {
    if (!doc || !user) return false;
    if (user.isGM) return true;
    if (user.id === game.user.id && doc.visible != null) return !!doc.visible;
    return this.testPermission(doc, user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED);
  }

  static testPermission(doc, user, level) {
    try {
      return !!doc.testUserPermission?.(user, level);
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to test document permission`, e);
      return false;
    }
  }

  static async handleButtonClick(event, app) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const doc = this.getDocumentFromApp(app);
    if (!this.isShowableDocument(doc)) return;

    if (!this.isOwner(doc)) {
      ui.notifications.warn("You may only show sheets you own.");
      return;
    }

    const activePlayersWithoutPermissions = this.getActivePlayers()
      .filter(user => !this.canView(doc, user));

    if (activePlayersWithoutPermissions.length) {
      const shouldUpdateOwnership = await this.confirmUpdateOwnership({
        count: activePlayersWithoutPermissions.length,
        doc,
      });

      if (shouldUpdateOwnership == null) return;
      if (shouldUpdateOwnership) await this.updateDefaultOwnership(doc);
    }

    await this.emitShowDocument(doc.uuid);
    await this.showDocument(doc.uuid);
    ui.notifications.info(`"${doc.name || app?.title || "Sheet"}" shown to authorized players.`);
  }

  static getActivePlayers() {
    const users = game.users?.contents || Array.from(game.users || []);
    return users.filter(user => user.active && !user.isGM);
  }

  static async confirmUpdateOwnership({count, doc}) {
    const userText = count === 1 ? "One active player cannot" : `${count} active players cannot`;
    const content = `<p>${userText} currently view <strong>${this.escapeHtml(doc.name || "this sheet")}</strong>.</p><p>Make it visible to all players before showing it?</p>`;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.confirm) {
      return DialogV2.confirm({
        window: {title: "Update Permissions"},
        content,
        yes: {label: "Make Visible"},
        no: {label: "Show Current Viewers"},
        rejectClose: false,
      });
    }

    return Dialog.confirm({
      title: "Update Permissions",
      content,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
  }

  static escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  static async updateDefaultOwnership(doc) {
    const target = this.getOwnershipTarget(doc);
    if (!target?.update) {
      ui.notifications.warn("This sheet does not have editable ownership data.");
      return;
    }

    const ownership = foundry.utils.deepClone(target.ownership || {});
    ownership.default = Math.max(
      ownership.default ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
    );

    try {
      await target.update({ownership});
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to update document ownership`, e);
      ui.notifications.warn("Unable to update this sheet's ownership. Showing it only to current viewers.");
    }
  }

  static getOwnershipTarget(doc) {
    const seen = new Set();
    let current = doc.parent || doc.actor || doc;

    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.ownership && current.testUserPermission && current.update) return current;
      current = current.parent || current.actor || null;
    }

    return doc;
  }

  static async emitShowDocument(uuid) {
    game.socket?.emit(SOCKET_NAME, {
      type: "showDocument",
      uuid,
      userId: game.user.id,
    });
  }

  static onSocketData(data) {
    if (data?.type !== "showDocument") return;
    if (data.userId === game.user.id) return;
    return this.showDocument(data.uuid);
  }

  static async showDocument(uuid) {
    if (!uuid) return;

    const doc = await fromUuid(uuid);
    if (!this.canView(doc)) return;

    if (!doc.sheet) return;
    return doc.sheet.render(true);
  }
}

Hooks.once("init", () => ShowPlayersUniversal.init());
Hooks.once("ready", () => ShowPlayersUniversal.ready());
