#!/usr/bin/env node

/**
 * WordPress Plugin Version Release Tool (NPX Version)
 * 
 * This script performs the following operations:
 * 1. Updates version numbers (package.json, composer.json and main plugin file)
 * 2. Installs dependencies (npm and composer)
 * 3. Builds frontend code
 * 4. Creates a ZIP package excluding unnecessary files
 * 5. Uploads the ZIP file to the update server
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const ftp = require('basic-ftp');
const ConfigStore = require('configstore');
require('dotenv').config();

// Load package.json relatively
let packageJson;
try {
  packageJson = require('../package.json');
} catch (error) {
  // It might be in a different path when loaded as a module
  packageJson = { name: 'wp-tools' };
}

// Create ConfigStore instance
const configStore = new ConfigStore(packageJson.name || 'wp-tools');

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

// readline interface for getting user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Default configuration
const defaultConfig = {
  pluginName: '',
  pluginSlug: '',
  mainFile: '',
  buildCommand: 'npm run build',
  packageManager: 'npm',
  includeFiles: [],
  excludedFiles: [
    'node_modules',
    '.git',
    '.github',
    '.gitignore',
    '.DS_Store',
    'package-lock.json',
    'composer.lock',
    '.phpunit.result.cache',
    'phpunit.xml',
    'tests',
    '.env',
    '.env.example'
  ],
  ftpConfig: {
    enabled: false,
    host: '',
    user: '',
    password: '',
    port: 21,
    path: ''
  }
};

// Project root directory
const rootDir = process.cwd();

// Log function
const log = (message, color = colors.reset) => {
  console.log(`${color}${message}${colors.reset}`);
};

// Run command and show output
const runCommand = (command, workingDir = rootDir) => {
  try {
    log(`Running command: ${command}`, colors.blue);
    const output = execSync(command, { cwd: workingDir, stdio: 'inherit' });
    return { success: true, output };
  } catch (error) {
    log(`Command error: ${error.message}`, colors.red);
    return { success: false, error };
  }
};

// Increment version number
const incrementVersion = (version, releaseType) => {
  const [major, minor, patch] = version.split('.').map(Number);
  
  switch (releaseType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
};

// Load configuration file
const loadConfig = (skipPrompts = false) => {
  const configPath = path.join(rootDir, 'wp-tools.json');
  
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...config };
    } catch (error) {
      log(`Error reading configuration file: ${error.message}`, colors.red);
    }
  }
  
  // If configuration file doesn't exist, get basic info from the user
  return createDefaultConfig(skipPrompts);
};

// Get and create basic configuration information
const createDefaultConfig = async (skipPrompts = false) => {
  const config = { ...defaultConfig };
  
  // Get info from package.json if it exists
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageData.name) {
        config.pluginSlug = packageData.name;
        config.pluginName = packageData.name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      }
      
      // Determine package manager
      if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
        config.packageManager = 'yarn';
      } else if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
        config.packageManager = 'pnpm';
      }
    } catch (error) {
      log(`Error reading package.json: ${error.message}`, colors.yellow);
    }
  }
  
  // Find the main plugin file
  const phpFiles = fs.readdirSync(rootDir).filter(file => file.endsWith('.php'));
  for (const file of phpFiles) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    if (content.includes('Plugin Name:') && content.includes('Version:')) {
      config.mainFile = file;
      
      // Get plugin name and slug
      const pluginNameMatch = content.match(/Plugin Name:\s*([^\r\n]+)/);
      if (pluginNameMatch && pluginNameMatch[1]) {
        config.pluginName = pluginNameMatch[1].trim();
        config.pluginSlug = config.pluginName.toLowerCase().replace(/\s+/g, '-');
      }
      
      break;
    }
  }
  
  // Request basic information from the user
  if (!config.pluginName || !config.pluginSlug || !config.mainFile) {
    if (skipPrompts) {
      log('Plugin information could not be determined automatically and prompts are skipped (--yes).', colors.red);
      log('Please create or complete the wp-tools.json configuration file manually.', colors.red);
      throw new Error('Missing configuration and prompts are skipped.');
    }

    log('Plugin information could not be determined automatically. Please enter manually:', colors.yellow);
    
    if (!config.pluginName) {
      config.pluginName = await prompt('Plugin name: ');
    }
    
    if (!config.pluginSlug) {
      config.pluginSlug = await prompt('Plugin slug name (directory-name-format): ', 
        config.pluginName.toLowerCase().replace(/\s+/g, '-'));
    }
    
    if (!config.mainFile) {
      config.mainFile = await prompt('Main plugin file (e.g., my-plugin.php): ', 
        `${config.pluginSlug}.php`);
    }
  }
  
  // Save configuration
  const configPath = path.join(rootDir, 'wp-tools.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  log(`Configuration file created: ${configPath}`, colors.green);
  
  return config;
};

// Prompt function
const prompt = (question, defaultValue = '') => {
  return new Promise((resolve) => {
    const defaultText = defaultValue ? ` (default: ${defaultValue})` : '';
    rl.question(`${question}${defaultText}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
};

// Update version numbers
const updateVersions = async (config, newVersion) => {
  try {
    let updated = false;
    
    // Update package.json
    const packageJsonPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      packageData.version = newVersion;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2) + '\n');
      log(`package.json updated: ${newVersion}`, colors.green);
      updated = true;
    }

    // Update composer.json
    const composerJsonPath = path.join(rootDir, 'composer.json');
    if (fs.existsSync(composerJsonPath)) {
      const composerData = JSON.parse(fs.readFileSync(composerJsonPath, 'utf8'));
      composerData.version = newVersion;
      fs.writeFileSync(composerJsonPath, JSON.stringify(composerData, null, 2) + '\n');
      log(`composer.json updated: ${newVersion}`, colors.green);
      updated = true;
    }

    // Update main plugin file
    const pluginFilePath = path.join(rootDir, config.mainFile);
    if (fs.existsSync(pluginFilePath)) {
      let pluginFileContent = fs.readFileSync(pluginFilePath, 'utf8');
      
      // Update Version in the plugin header
      const versionRegex = /Version:\s*[\d\.]+/;
      if (versionRegex.test(pluginFileContent)) {
        pluginFileContent = pluginFileContent.replace(
          versionRegex,
          `Version: ${newVersion}`
        );
        
        // Update constant definition if it exists
        const definePattern = new RegExp(`define\\(\\s*['"]${config.pluginSlug.toUpperCase().replace(/-/g, '_')}_VERSION['"],\\s*['"][\d\.]+['"]\s*\\);`);
        if (definePattern.test(pluginFileContent)) {
          pluginFileContent = pluginFileContent.replace(
            definePattern,
            `define('${config.pluginSlug.toUpperCase().replace(/-/g, '_')}_VERSION', '${newVersion}');`
          );
        }
        
        fs.writeFileSync(pluginFilePath, pluginFileContent);
        log(`Plugin file updated: ${newVersion}`, colors.green);
        updated = true;
      } else {
        log('Version header not found in the main plugin file.', colors.yellow);
      }
    } else {
      log(`Main plugin file not found: ${config.mainFile}`, colors.yellow);
    }

    // Git commit operation
    if (updated) {
      log('Performing Git commit operation...', colors.blue);
      
      let filesToCommit = [];
      if (fs.existsSync(packageJsonPath)) filesToCommit.push('package.json');
      if (fs.existsSync(composerJsonPath)) filesToCommit.push('composer.json');
      if (fs.existsSync(pluginFilePath)) filesToCommit.push(config.mainFile);
      
      if (filesToCommit.length > 0) {
        const gitAddResult = runCommand(`git add ${filesToCommit.join(' ')}`);
        if (!gitAddResult.success) {
          log('Git add operation failed.', colors.red);
          return false;
        }

        const gitCommitResult = runCommand(`git commit -m "version bump to ${newVersion}"`);
        if (!gitCommitResult.success) {
          log('Git commit operation failed.', colors.red);
          return false;
        }

        log('Git commit operation successful.', colors.green);
      }
    }

    return updated;
  } catch (error) {
    log(`Version update error: ${error.message}`, colors.red);
    return false;
  }
};

// Create ZIP archive
const createZipArchive = (config, version) => {
  const zipFileName = `${config.pluginSlug}.zip`;
  const zipFilePath = path.join(rootDir, zipFileName);
  const tempDir = path.join(rootDir, `.temp-release-${version}`);
  
  // Files and directories to include
  let includePatterns = [...config.includeFiles];
  
  // If includeFiles is empty, include all files
  if (includePatterns.length === 0) {
    // First get all files and folders in current directory
    try {
      includePatterns = fs.readdirSync(rootDir);
    } catch (error) {
      log(`Directory read error: ${error.message}`, colors.red);
      return false;
    }
  }
  
  // Files and directories to exclude
  const excludePatterns = [...config.excludedFiles];
  
  // Add main plugin file (if not already included)
  if (!includePatterns.includes(config.mainFile)) {
    includePatterns.push(config.mainFile);
  }

  // First delete previous ZIP file (if exists)
  try {
    if (fs.existsSync(zipFilePath)) {
      fs.unlinkSync(zipFilePath);
      log(`Old zip file deleted: ${zipFileName}`, colors.blue);
    }
  } catch (error) {
    log(`Error deleting old zip file: ${error.message}`, colors.red);
  }

  try {
    // Clean or create temporary folder
    if (fs.existsSync(tempDir)) {
      runCommand(`rm -rf "${tempDir}"`);
    }
    fs.mkdirSync(tempDir, { recursive: true });
    log(`Temporary folder created: ${tempDir}`, colors.blue);

    // Check for composer autoload file if using composer
    if (includePatterns.includes('vendor')) {
      const autoloadPath = path.join(rootDir, 'vendor/autoload.php');
      if (!fs.existsSync(autoloadPath)) {
        log('vendor/autoload.php not found! Composer packages may not be installed or missing.', colors.yellow);
      }
    }

    // Copy files
    log('Copying files to temporary folder...', colors.blue);
    
    // Use directory-based copy approach - copy each directory and file individually
    for (const pattern of includePatterns) {
      const sourcePath = path.join(rootDir, pattern);
      
      // Check if file/directory exists
      if (fs.existsSync(sourcePath)) {
        const targetPath = path.join(tempDir, pattern);
        
        // Create parent directory if it doesn't exist
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // Check if it's a directory or file and copy accordingly
        if (fs.statSync(sourcePath).isDirectory()) {
          // If directory, use rsync command to skip excluded files and folders
          // Create rsync --exclude patterns
          const excludeArgs = excludePatterns.map(pattern => `--exclude "${pattern}"`).join(' ');
          const copyCommand = `rsync -a ${excludeArgs} "${sourcePath}/" "${targetPath}/"`;
          const copyResult = runCommand(copyCommand);
          
          if (!copyResult.success) {
            // If rsync fails, try normal copy
            log(`rsync copy failed, trying normal copy...`, colors.yellow);
            const fallbackCommand = `cp -R "${sourcePath}" "${path.dirname(targetPath)}"`;
            const fallbackResult = runCommand(fallbackCommand);
            
            if (!fallbackResult.success) {
              throw new Error(`Error copying "${pattern}" directory.`);
            }
          }
          
          // Extra check if it's vendor folder
          if (pattern === 'vendor') {
            const targetAutoloadPath = path.join(tempDir, 'vendor/autoload.php');
            if (!fs.existsSync(targetAutoloadPath)) {
              log('vendor/autoload.php could not be copied to temporary folder!', colors.yellow);
            } else {
              log('vendor/autoload.php successfully copied.', colors.green);
            }
          }
        } else {
          // If file
          // Check if file is excluded
          const fileName = path.basename(sourcePath);
          if (excludePatterns.includes(fileName)) {
            log(`"${fileName}" is excluded.`, colors.yellow);
            continue;
          }
          
          const copyCommand = `cp "${sourcePath}" "${targetPath}"`;
          const copyResult = runCommand(copyCommand);
          
          if (!copyResult.success) {
            throw new Error(`Error copying "${pattern}" file.`);
          }
        }
        
        log(`"${pattern}" successfully copied.`, colors.green);
      } else {
        log(`"${pattern}" not found, skipping.`, colors.yellow);
      }
    }

    // Create ZIP from temporary folder
    log('Creating ZIP file...', colors.blue);
    const zipCommand = `cd "${tempDir}" && zip -rq "${zipFilePath}" .`;
    const zipResult = runCommand(zipCommand);
    
    if (!zipResult.success) {
      throw new Error('Error creating ZIP file.');
    }

    // Clean temporary folder
    runCommand(`rm -rf "${tempDir}"`);
    log(`Temporary folder cleaned.`, colors.blue);
    
    log(`ZIP file created: ${zipFileName}`, colors.green);
    log(`File location: ${zipFilePath}`, colors.green);
    
    return true;
  } catch (error) {
    log(`ZIP file creation error: ${error.message}`, colors.red);
    
    // Try to clean temporary folder if error occurs
    if (fs.existsSync(tempDir)) {
      runCommand(`rm -rf "${tempDir}"`);
    }
    
    return false;
  }
};

// Create FTP client
const createFtpClient = async (config) => {
  const client = new ftp.Client();
  client.ftp.verbose = true;
  
  try {
    // First get info from configStore, otherwise check config and env
    const ftpHost = configStore.get('ftp.host') || config.ftpConfig.host || process.env.FTP_HOST;
    const ftpUser = configStore.get('ftp.user') || config.ftpConfig.user || process.env.FTP_USER;
    const ftpPass = configStore.get('ftp.password') || config.ftpConfig.password || process.env.FTP_PASS;
    const ftpPort = parseInt(configStore.get('ftp.port') || config.ftpConfig.port || process.env.FTP_PORT || '21');
    const ftpPath = configStore.get('ftp.path') || config.ftpConfig.path || process.env.UPDATE_SERVER_PATH || '/';
    
    if (!ftpHost || !ftpUser || !ftpPass) {
      throw new Error('FTP details are missing. Please set your FTP details using the "set-ftp" command.');
    }
    
    await client.access({
      host: ftpHost,
      user: ftpUser,
      password: ftpPass,
      port: ftpPort,
      secure: false
    });
    
    log('FTP connection successful.', colors.green);
    return client;
  } catch (error) {
    log(`FTP connection error: ${error.message}`, colors.red);
    throw error;
  }
};

// Upload ZIP file to FTP
const uploadReleaseToFtp = async (config, version, zipFilePath) => {
  log('Starting FTP upload...', colors.blue);
  log(`FTP Configuration:`, colors.blue);
  log(`- configStore.enabled: ${configStore.get('ftp.enabled')}`, colors.blue);
  log(`- config.ftpConfig.enabled: ${config.ftpConfig.enabled}`, colors.blue);
  
  if (!config.ftpConfig.enabled && !configStore.get('ftp.enabled')) {
    log('FTP upload is disabled. Skipping.', colors.yellow);
    return true;
  }
  
  log(`ZIP File: ${zipFilePath}`, colors.blue);
  if (!fs.existsSync(zipFilePath)) {
    log(`ZIP file not found: ${zipFilePath}`, colors.red);
    return false;
  }
  
  let client;
  try {
    log('Creating FTP client...', colors.blue);
    client = await createFtpClient(config);
    
    // Go to the update server directory
    const uploadPath = configStore.get('ftp.path') || config.ftpConfig.path || process.env.UPDATE_SERVER_PATH || '/';
    log(`Changing to target directory: ${uploadPath}`, colors.blue);
    await client.ensureDir(uploadPath);
    log(`Changed to upload directory: ${uploadPath}`, colors.blue);
    
    // Upload the ZIP file
    log('Uploading ZIP file...', colors.blue);
    await client.uploadFrom(zipFilePath, `${config.pluginSlug}.zip`);
    log('ZIP file uploaded successfully.', colors.green);
    
    return true;
  } catch (error) {
    log(`FTP upload error: ${error.message}`, colors.red);
    if (error.stack) {
      log(`Error details: ${error.stack}`, colors.red);
    }
    return false;
  } finally {
    if (client) {
      client.close();
    }
  }
};

// Set FTP configuration
const setFtpConfig = async () => {
  log('===== SET FTP CONFIGURATION =====', colors.cyan);
  
  const host = await prompt('FTP Server address', configStore.get('ftp.host') || '');
  const user = await prompt('FTP Username', configStore.get('ftp.user') || '');
  const password = await prompt('FTP Password', configStore.get('ftp.password') || '');
  const port = await prompt('FTP Port (default: 21)', configStore.get('ftp.port') || '21');
  const path = await prompt('Upload directory on server (default: /)', configStore.get('ftp.path') || '/');
  
  // Save information
  configStore.set('ftp.host', host);
  configStore.set('ftp.user', user);
  configStore.set('ftp.password', password);
  configStore.set('ftp.port', port);
  configStore.set('ftp.path', path);
  configStore.set('ftp.enabled', true);
  
  log('FTP configuration successfully saved.', colors.green);
  log('FTP upload automatically enabled.', colors.green);
  log('To disable this configuration, use "npx wp-tools ftp-disable" command.', colors.blue);
  
  // Want to test connection?
  const testConnection = (await prompt('Would you like to test the FTP connection? [y/n]', 'y')).toLowerCase() === 'y';
  if (testConnection) {
    try {
      const client = new ftp.Client();
      client.ftp.verbose = true;
      
      await client.access({
        host: host,
        user: user,
        password: password,
        port: parseInt(port),
        secure: false
      });
      
      log('FTP connection test successful!', colors.green);
      
      // Directory check
      try {
        await client.ensureDir(path);
        log(`Upload directory exists and is accessible: ${path}`, colors.green);
      } catch (error) {
        log(`Upload directory error: ${error.message}`, colors.red);
        log('Upload directory does not exist or you do not have access.', colors.yellow);
      }
      
      client.close();
    } catch (error) {
      log(`FTP connection test failed: ${error.message}`, colors.red);
    }
  }
  
  rl.close();
};

// Disable FTP upload
const disableFtp = () => {
  configStore.set('ftp.enabled', false);
  log('FTP upload disabled.', colors.yellow);
  log('To re-enable, you can use the "npx wp-tools set-ftp" command.', colors.blue);
  rl.close();
};

// Show FTP configuration
const showFtpConfig = () => {
  log('===== SAVED FTP INFORMATION =====', colors.cyan);
  
  const host = configStore.get('ftp.host');
  const user = configStore.get('ftp.user');
  const port = configStore.get('ftp.port');
  const path = configStore.get('ftp.path');
  const enabled = configStore.get('ftp.enabled');
  
  if (!host || !user) {
    log('No saved FTP information found.', colors.yellow);
    log('You can set the FTP information using the "npx wp-tools set-ftp" command.', colors.blue);
  } else {
    log(`FTP Server: ${host}:${port}`, colors.reset);
    log(`FTP User: ${user}`, colors.reset);
    log(`Upload Directory: ${path}`, colors.reset);
    log(`Status: ${enabled ? colors.green + 'Enabled' : colors.yellow + 'Disabled'}`, colors.reset);
  }
  
  rl.close();
};

// Main release function
const release = async (skipPrompts = false) => {
  log('===== WORDPRESS PLUGIN VERSION RELEASE TOOL =====', colors.cyan);
  
  // Load configuration
  let config;
  try {
    config = await loadConfig(skipPrompts);
  } catch (error) {
    log(`Configuration error: ${error.message}`, colors.red);
    rl.close();
    return; // Stop execution if config loading failed
  }
  
  // Get current version from the main plugin file or package.json
  let currentVersion = '0.1.0';
  
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      currentVersion = packageData.version;
    } catch (error) {
      log(`Error reading package.json: ${error.message}`, colors.yellow);
    }
  }
  
  log(`Plugin: ${config.pluginName}`, colors.cyan);
  log(`Current version: ${currentVersion}`, colors.yellow);
  
  // Check command line arguments
  const args = process.argv.slice(2);
  let releaseType = '';
  
  // If the first argument is "release", skip it and look at the next ones
  const startIndex = args[0] === 'release' ? 1 : 0;
  
  // Process arguments to find release type
  if (args.length > startIndex) {
    // The first/second argument can be the version type
    if (['patch', 'minor', 'major'].includes(args[startIndex].toLowerCase())) {
      releaseType = args[startIndex].toLowerCase();
      log(`Version type from command line: ${releaseType}`, colors.blue);
      
      // Subsequent arguments can be --yes or -y (already handled before calling release)
      // We don't need to parse --yes here anymore as it's passed in
    }
  }
  
  // Ask for release type ONLY if not provided via args
  // If skipPrompts is true and type not provided, default to patch
  if (!releaseType) {
    if (skipPrompts) {
      log('Release type not provided via command line. Defaulting to "patch" because --yes flag is present.', colors.yellow);
      releaseType = 'patch';
    } else {
      releaseType = await prompt(
        `What type of version increment? [patch/minor/major]`,
        'patch'
      );
      if (!['patch', 'minor', 'major'].includes(releaseType.toLowerCase())) {
        log('Invalid choice. Using "patch".', colors.yellow);
        releaseType = 'patch';
      }
    }
  }
  
  // Calculate new version number
  const newVersion = incrementVersion(currentVersion, releaseType);
  log(`New version: ${newVersion}`, colors.green);
  
  // Get confirmation from the user (if not skipped)
  let confirmed = skipPrompts;
  if (!skipPrompts) {
    confirmed = (await prompt(`Do you want to continue with this operation? [y/n]`, 'y')).toLowerCase() === 'y';
  }
  
  if (!confirmed) {
    log('Operation cancelled.', colors.yellow);
    rl.close();
    return;
  }
  
  // Update version numbers
  if (!await updateVersions(config, newVersion)) {
    log('Version update failed.', colors.red);
  }
  
  // Select package manager
  const packageManager = config.packageManager || 'npm';
  
  // Install NPM packages
  log(`Installing ${packageManager.toUpperCase()} packages...`, colors.blue);
  const installCommand = {
    npm: 'npm install',
    yarn: 'yarn install',
    pnpm: 'pnpm install'
  }[packageManager] || 'npm install';
  
  const npmInstallResult = runCommand(installCommand);
  if (!npmInstallResult.success) {
    log(`Error installing ${packageManager.toUpperCase()} packages. Continuing operation.`, colors.yellow);
  }
  
  // Install Composer packages (if composer.json exists)
  if (fs.existsSync(path.join(rootDir, 'composer.json'))) {
    log('Installing Composer packages...', colors.blue);
    const composerInstallResult = runCommand('composer install --no-dev --optimize-autoloader');
    if (!composerInstallResult.success) {
      log('Error installing Composer packages.', colors.yellow);
    } else {
      log('Composer packages installed successfully.', colors.green);
    }
  }
  
  // Build frontend code
  if (config.buildCommand) {
    log('Building frontend code...', colors.blue);
    const buildResult = runCommand(config.buildCommand);
    if (!buildResult.success) {
      log('Error building frontend code.', colors.yellow);
    }
  }
  
  // Create ZIP file
  log('Creating ZIP file...', colors.blue);
  const zipResult = createZipArchive(config, newVersion);
  if (!zipResult) {
    log('Error creating ZIP file.', colors.red);
    rl.close();
    return;
  }
  
  // Start FTP upload process
  if (config.ftpConfig.enabled || configStore.get('ftp.enabled')) {
    log('Starting FTP upload...', colors.blue);
    const zipFilePath = path.join(rootDir, `${config.pluginSlug}.zip`);
    const uploadResult = await uploadReleaseToFtp(config, newVersion, zipFilePath);
    
    if (!uploadResult) {
      log('FTP upload failed.', colors.red);
    } else {
      log('FTP upload successful.', colors.green);
    }
  }
  
  log('===== RELEASE PROCESS COMPLETED =====', colors.cyan);
  log(`Plugin: ${config.pluginName}`, colors.cyan);
  log(`New version: ${newVersion}`, colors.green);
  log(`ZIP file: ${config.pluginSlug}.zip`, colors.green);
  
  rl.close();
};

// Process command
const processCommand = () => {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Check for --yes or -y flag globally first
  let skipPrompts = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes' || args[i] === '-y') {
      skipPrompts = true;
      log('Confirmation prompts will be skipped.', colors.blue);
      break;
    }
  }

  if (!command) {
    // If command is not specified, show help
    showHelp();
    return;
  }
  
  switch (command) {
    case 'init':
      // Create configuration file
      createDefaultConfig(skipPrompts).then(() => {
        log('Configuration file created successfully.', colors.green);
        rl.close();
      });
      break;
      
    case 'release':
      // Normal version release process
      // Pass skipPrompts status
      release(skipPrompts);
      break;
      
    case 'set-ftp':
      // Set FTP information
      setFtpConfig();
      break;
      
    case 'ftp-disable':
      // Disable FTP upload
      disableFtp();
      break;
      
    case 'show-ftp':
      // Show FTP information
      showFtpConfig();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      // Show help information
      showHelp();
      break;
      
    case 'major':
      // Version type entered directly, process as release
      // Pass skipPrompts status
      release(skipPrompts);
      break;
      
    default:
      log(`Unknown command: ${command}`, colors.red);
      showHelp();
      break;
  }
};

// Show help information
const showHelp = () => {
  log('===== WORDPRESS PLUGIN VERSION RELEASE TOOL =====', colors.cyan);
  log('Usage:', colors.yellow);
  log('  npx wp-tools release [patch|minor|major] [--yes/-y]', colors.reset);
  log('  npx wp-tools [patch|minor|major] [--yes/-y]', colors.reset);
  log('  npx wp-tools init', colors.reset);
  log('  npx wp-tools set-ftp', colors.reset);
  log('  npx wp-tools show-ftp', colors.reset);
  log('  npx wp-tools ftp-disable', colors.reset);
  log('  npx wp-tools help', colors.reset);
  log('', colors.reset);
  log('Commands:', colors.yellow);
  log('  release            Perform version release process', colors.reset);
  log('  patch|minor|major  Version increment type (can be used with release command or alone)', colors.reset);
  log('  init              Create configuration file', colors.reset);
  log('  set-ftp           Set and save FTP configuration', colors.reset);
  log('  show-ftp          Display saved FTP configuration', colors.reset);
  log('  ftp-disable       Disable FTP upload', colors.reset);
  log('  help              Show this help message', colors.reset);
  log('', colors.reset);
  log('Options:', colors.yellow);
  log('  --yes, -y         Continue without confirmation', colors.reset);
  log('', colors.reset);
  log('Configuration:', colors.yellow);
  log('  Edit wp-tools.json file to specify files and directories to include (includeFiles)', colors.reset);
  log('  or exclude (excludedFiles) in the ZIP package.', colors.reset);
  rl.close();
};

// Run the script
processCommand(); 