# WordPress Plugin Version Release Tool

A command-line tool to streamline the version release process for WordPress plugins. This tool automates several steps including version bumping, dependency installation, building assets, packaging the plugin into a ZIP file, and optionally uploading it to an update server via FTP.

## Features

*   **Version Bumping:** Updates version numbers in `package.json`, `composer.json`, and the main plugin PHP file header.
*   **Dependency Management:** Installs NPM (npm, yarn, pnpm) and Composer dependencies.
*   **Build Process:** Runs your defined build command (e.g., for frontend assets).
*   **Packaging:** Creates a clean `.zip` archive of your plugin, excluding unnecessary files and development directories. The generated ZIP is suitable for WordPress installation and update mechanisms.
*   **FTP Upload:** Optionally uploads the generated `.zip` file to a specified FTP server path. This is particularly useful for hosting your own updates using systems like [WP Update Server](https://github.com/YahnisElsts/wp-update-server).
*   **Configuration:** Uses a `wp-tools.json` file for project-specific settings and `configstore` for global FTP credentials.
*   **Interactive & Automated:** Can be run interactively or automated using command-line arguments (`--yes`).

## Usage (via NPX)

This tool is designed to be run directly using `npx` without global installation.

```bash
npx wp-tools <command> [options]
```

### Initial Setup

Before the first release, you need a configuration file.

1.  **Generate Configuration:** Run the `init` command in your plugin's root directory.
    ```bash
    npx wp-tools init
    ```
    This will attempt to auto-detect your plugin's name, slug, and main file. If it fails, it will prompt you for the necessary information. It creates a `wp-tools.json` file in your project root.

2.  **Review `wp-tools.json`:** Open the generated `wp-tools.json` and adjust the settings if needed, especially `includeFiles`, `excludedFiles`, and `buildCommand`. See the [Configuration](#configuration) section for details.

3.  **(Optional) Configure FTP:** If you want to automatically upload the release ZIP file, configure your FTP credentials:
    ```bash
    npx wp-tools set-ftp
    ```
    This will securely store your FTP host, user, password, port, and path using `configstore`. The path should typically point to the directory where your update server (like [WP Update Server](https://github.com/YahnisElsts/wp-update-server)'s `packages` directory) expects the ZIP files. You can disable FTP uploads anytime with `npx wp-tools ftp-disable`.

### Performing a Release

Once configured, releasing a new version is simple:

```bash
# Perform a patch release (e.g., 1.0.0 -> 1.0.1)
npx wp-tools patch

# Perform a minor release (e.g., 1.0.1 -> 1.1.0)
npx wp-tools minor

# Perform a major release (e.g., 1.1.0 -> 2.0.0)
npx wp-tools major
```

You can also use the `release` command explicitly:

```bash
npx wp-tools release patch
npx wp-tools release minor
npx wp-tools release major
```

**Automation / Skipping Prompts:**

To run the release process without any confirmation prompts (useful in CI/CD pipelines or scripts), use the `--yes` or `-y` flag:

```bash
npx wp-tools patch --yes
npx wp-tools release minor -y
```

**Note:** If using `--yes`, ensure your `wp-tools.json` is correctly configured. If configuration is missing (e.g., `pluginName`), the script will exit with an error instead of prompting. If the release type (`patch`, `minor`, `major`) is omitted when using `--yes`, it will default to `patch`.

### Available Commands

*   `release [patch|minor|major] [--yes|-y]`: Performs the full release process (version bump, install, build, zip, upload).
*   `[patch|minor|major] [--yes|-y]`: Shorthand for the `release` command.
*   `init`: Creates the `wp-tools.json` configuration file interactively.
*   `set-ftp`: Interactively sets and saves FTP credentials for uploading. Enables FTP upload.
*   `show-ftp`: Displays the currently saved FTP configuration (excluding password).
*   `ftp-disable`: Disables the automatic FTP upload feature.
*   `help`, `--help`, `-h`: Shows the help message with all commands and options.

## Configuration (`wp-tools.json`)

This file stores project-specific settings.

```json
{
  "pluginName": "My Awesome Plugin", // Human-readable plugin name
  "pluginSlug": "my-awesome-plugin", // Plugin slug (directory name)
  "mainFile": "my-awesome-plugin.php", // Main plugin PHP file
  "buildCommand": "npm run build", // Command to build assets (set to "" or null to skip)
  "packageManager": "npm", // Or "yarn", "pnpm". Auto-detected usually.
  "includeFiles": [          // Files/folders to *explicitly* include. If empty, includes everything except excluded.
    "assets",
    "includes",
    "languages",
    "vendor", // Make sure composer dependencies are installed
    "readme.txt",
    "index.php"
    // Add other essential files/folders here
  ],
  "excludedFiles": [        // Files/folders to exclude from the ZIP. Defaults are usually sufficient.
    "node_modules",
    ".git",
    ".github",
    ".gitignore",
    ".DS_Store",
    "package-lock.json",
    "composer.lock",
    ".phpunit.result.cache",
    "phpunit.xml",
    "tests",
    ".env",
    ".env.example",
    "wp-tools.json", // Exclude the config itself
    "*.zip" // Exclude previous zip files
  ],
  "ftpConfig": {            // Project-level FTP fallback (less secure, prefer set-ftp)
    "enabled": false,       // Overridden by global setting from set-ftp if enabled there.
    "host": "",
    "user": "",
    "password": "",
    "port": 21,
    "path": "/"             // Upload path on the FTP server
  }
}
```

*   **`includeFiles`:** If this array is *empty*, the tool attempts to include *all* files and directories in the project root, except those listed in `excludedFiles`. If you specify items in `includeFiles`, *only* those items (relative to the root) will be copied to the temporary directory before zipping (respecting `excludedFiles` within those directories if using `rsync`). Always ensure your `mainFile` and essential directories like `vendor` (if using Composer) are included.
*   **`excludedFiles`:** A list of glob patterns or filenames/directory names to exclude from the final ZIP package.
*   **`ftpConfig`:** While you can define FTP settings here, it's **highly recommended** to use `npx wp-tools set-ftp` instead, which stores credentials more securely outside your project repository. Settings from `set-ftp` (stored globally via `configstore`) override the `enabled` status and credentials in this file if FTP is globally enabled.

## Environment Variables (`.env`)

As an alternative to `set-ftp` or `wp-tools.json`, you can define FTP credentials using a `.env` file in your project root (ensure `.env` is in your `.gitignore`!):

```dotenv
FTP_HOST=ftp.example.com
FTP_USER=your_username
FTP_PASS=your_password
FTP_PORT=21
UPDATE_SERVER_PATH=/public_html/updates
```

Credentials are prioritized in this order: `configstore` (from `set-ftp`) > `.env` file > `wp-tools.json`.

---

This tool aims to simplify the repetitive tasks involved in releasing WordPress plugin updates. Adapt the configuration to fit your specific project structure and build process. 

While the FTP upload feature is tailored for simple update servers like [WP Update Server](https://github.com/YahnisElsts/wp-update-server), the generated ZIP file itself is standard and can be used for manual uploads to WordPress.org, other marketplaces, or integrated into different deployment workflows. 