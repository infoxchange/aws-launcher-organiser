<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## AWS Launcher Organiser Extension

This is a WXT-based browser extension that organizes AWS accounts on the launcher page.

### Project Setup

- [x] Installed dependencies
- [x] Configured TypeScript and build
- [x] Configured Biome linting
- [x] Built project (Chrome and Firefox)
- [x] Verified development mode works

### Development Guidelines

- Use TypeScript for all code
- Use Biome for linting: `npm run lint`, `npm run lint:fix`, `npm run format`
- Use React for UI components if needed
- Entrypoints go in the `entrypoints/` directory
- WXT documentation: https://wxt.dev

### Build Commands

- `npm run dev` - Development mode with hot reload
- `npm run build` - Build for Chrome
- `npm run build:all` - Build for Firefox and Chrome
- `npm run build:firefox` - Build for Firefox only
- `npm run build:chrome` - Build for Chrome only

