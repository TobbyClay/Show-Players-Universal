# Show Players Universal

Standalone Foundry VTT module for Foundry V13+ that adds a system-agnostic **Show Players** button to owned document sheets.

It is not tied to Plutonium or dnd5e. The module injects the button through Foundry's generic sheet header hooks and supports both legacy `Application` sheets and `ApplicationV2` header controls.

## Behavior

- Shows the button on owned sheets with a UUID and renderable sheet.
- Sends the sheet UUID over Foundry's module socket.
- Each client opens the sheet only if their user can view the document.
- If active players cannot view the sheet, the sender is prompted to make the document visible by raising default ownership to Limited.
- Embedded documents, such as actor-owned items, update the nearest parent document with ownership data.

## Setting

`Minimum Role` controls who can see the button. The default is Assistant GM.
