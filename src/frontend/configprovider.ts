import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { GDBServerConsole } from './server_console';
import {
    ADAPTER_DEBUG_MODE, ChainedConfigurations, ChainedEvents, CortexDebugKeys,
    sanitizeDevDebug, validateELFHeader, SymbolFile, defSymbolFile
} from '../common';
import { CDebugChainedSessionItem, CDebugSession } from './cortex_debug_session';
import * as path from 'path';

const VALID_RTOS: string[] = ['zephyr'];

export class CortexDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private context: vscode.ExtensionContext) {}

    public provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [{
            name: 'Cortex Debug',
            cwd: '${workspaceFolder}',
            executable: './bin/executable.elf',
            request: 'launch',
            type: 'cortex-debug',
            runToEntryPoint: 'main',
            servertype: 'bmp'
        }];
    }

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (GDBServerConsole.BackendPort <= 0) {
            vscode.window.showErrorMessage('GDB server console not yet ready. Please try again. Report this problem');
            return undefined;
        }
        config.gdbServerConsolePort = GDBServerConsole.BackendPort;
        config.pvtAvoidPorts = CDebugSession.getAllUsedPorts();

        // Flatten the platform specific stuff as it is not done by VSCode at this point.
        switch (os.platform()) {
            case 'darwin':
                Object.assign(config, config.osx);
                break;
            case 'win32':
                Object.assign(config, config.windows);
                break;
            case 'linux':
                Object.assign(config, config.linux);
                break;
            default:
                console.log(`Unknown platform ${os.platform()}`);
                break;
        }
        // Delete all OS props instead just the current one. See Issue#1114
        delete config.osx;
        delete config.windows;
        delete config.linux;

        this.sanitizeChainedConfigs(config);
        if (config.debugger_args && !config.debuggerArgs) {
            config.debuggerArgs = config.debugger_args;
        }
        if (!config.debuggerArgs) { config.debuggerArgs = []; }

        const type = config.servertype;

        let validationResponse: string = null;

        if (!config.swoConfig) {
            config.swoConfig = { enabled: false, decoders: [], cpuFrequency: 0, swoFrequency: 0, source: 'probe' };
        } else if (config.swoConfig?.enabled) {
            if (!config.swoConfig.cpuFrequency) {
                config.swoConfig.cpuFrequency = 1 * 1e6;
                vscode.window.showWarningMessage(
                    `launch.json: Missing/Invalid swoConfig.cpuFrequency. setting to ${config.swoConfig.cpuFrequency} Hz`);
            }
            if (!config.swoConfig.swoFrequency) {
                config.swoConfig.swoFrequency = config.swoConfig.cpuFrequency / 2;
                vscode.window.showWarningMessage(
                    `launch.json: Missing/Invalid swoConfig.swoFrequency. setting to ${config.swoConfig.swoFrequency} Hz`);
            }
            if (config.swoConfig.ports && !config.swoConfig.decoders) {
                config.swoConfig.decoders = config.swoConfig.ports;
            }
            if (!config.swoConfig.swoEncoding) { config.swoConfig.swoEncoding = 'uart'; }
            if (!config.swoConfig.source) { config.swoConfig.source = 'probe'; }
            if (!config.swoConfig.decoders) { config.swoConfig.decoders = []; }
            config.swoConfig.decoders.forEach((d, idx) => {
                if (d.type === 'advanced') {
                    if (d.ports === undefined && d.number !== undefined) {
                        d.ports = [d.number];
                    }
                } else {
                    if (d.port === undefined && d.number !== undefined) {
                        d.port = d.number;
                    }
                }
            });
        }
        if (!config.rttConfig) {
            config.rttConfig = { enabled: false, decoders: [] };
        } else if (!config.rttConfig.decoders) {
            config.rttConfig.decoders = [];
        }

        if (!config.graphConfig) { config.graphConfig = []; }
        if (!config.preLaunchCommands) { config.preLaunchCommands = []; }
        if (!config.postLaunchCommands) { config.postLaunchCommands = []; }
        if (!config.preAttachCommands) { config.preAttachCommands = []; }
        if (!config.postAttachCommands) { config.postAttachCommands = []; }
        if (!config.preResetCommands) { config.preResetCommands = config.preRestartCommands || []; }
        if (!config.postResetCommands) { config.postResetCommands = config.postRestartCommands || []; }
        if (config.overridePreEndSessionCommands === undefined) { config.overridePreEndSessionCommands = null; }
        if (!config.postResetSessionCommands) { config.postResetSessionCommands = config.postRestartSessionCommands || null; }
        if (config.runToEntryPoint) { config.runToEntryPoint = config.runToEntryPoint.trim(); } else if (config.runToMain) {
            config.runToEntryPoint = 'main';
            vscode.window.showWarningMessage(
                'launch.json: "runToMain" has been deprecated and will not work in future versions of Cortex-Debug. Please use "runToEntryPoint" instead');
        }

        switch (type) {
            case 'bmp':
                validationResponse = this.verifyBMPConfiguration(folder, config);
                break;
            case 'external':
                validationResponse = this.verifyExternalConfiguration(folder, config);
                break;
            case 'qemu':
                validationResponse = this.verifyQEMUConfiguration(folder, config);
                break;
            default: {
                const validValues = [
                    'bmp',
                    'external',
                    'qemu'
                ].map((s) => `"${s}"`).join(', ');
                validationResponse = 'Invalid servertype parameters. The following values are supported: ' + validValues;
                break;
            }
        }

        const configuration = vscode.workspace.getConfiguration('cortex-debug');
        if (config.pvtAdapterDebugOptions === undefined) {
            config.pvtAdapterDebugOptions = configuration.get('pvtAdapterDebugOptions', {});
        }
        if (typeof config.pvtAdapterDebugOptions !== 'object') {
            config.pvtAdapterDebugOptions = {};
        }
        if (config.showDevDebugOutput === undefined) {
            config.showDevDebugOutput = configuration.get(CortexDebugKeys.DEV_DEBUG_MODE, ADAPTER_DEBUG_MODE.NONE);
        }
        if (!sanitizeDevDebug(config as unknown)) {
            const modes = Object.values(ADAPTER_DEBUG_MODE).join(',');
            vscode.window.showInformationMessage(`launch.json: "showDevDebugOutput" muse be one of ${modes}. Setting to "${config.showDevDebugOutput}"`);
        }

        if (config.armToolchainPath) { config.toolchainPath = config.armToolchainPath; }
        this.setOsSpecficConfigSetting(config, 'toolchainPath', 'armToolchainPath');



        if (!config.toolchainPrefix) {
            config.toolchainPrefix = configuration.armToolchainPrefix || 'arm-none-eabi';
        }

        this.setOsSpecficConfigSetting(config, 'gdbPath');
        this.setOsSpecficConfigSetting(config, 'objdumpPath');
        config.extensionPath = this.context.extensionPath;
        if (os.platform() === 'win32') {
            config.extensionPath = config.extensionPath.replace(/\\/g, '/'); // GDB doesn't interpret the path correctly with backslashes.
        }

        config.registerUseNaturalFormat = configuration.get(CortexDebugKeys.REGISTER_DISPLAY_MODE, true);
        config.variableUseNaturalFormat = configuration.get(CortexDebugKeys.VARIABLE_DISPLAY_MODE, true);

        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }

        return config;
    }

    public resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        const wsFile = vscode.workspace.workspaceFile?.fsPath;
        let cwd = config.cwd || folder?.uri.fsPath || (wsFile ? path.dirname(wsFile) : '.');
        const isAbsCwd = path.isAbsolute(cwd);
        if (!isAbsCwd && folder) {
            cwd = path.join(folder.uri.fsPath, cwd);
        } else if (!isAbsCwd) {
            cwd = path.resolve(cwd);
        }
        config.cwd = cwd;
        if (!cwd || !fs.existsSync(cwd)) {
            vscode.window.showWarningMessage(`Invalid "cwd": "${cwd}". Many operations can fail. Trying to continue`);
        }
        this.validateLoadAndSymbolFiles(config, cwd);

        const extension = vscode.extensions.getExtension('marus25.cortex-debug');
        config.pvtVersion = extension?.packageJSON?.version || '<unknown version>';

        if (config.liveWatch?.enabled) {
            vscode.window.showInformationMessage(
                `Live watch may not be supported for servertype '${config.servertype}'. `
                + 'Report back to us if it works with your servertype.\n \n'
                + 'If you are using an "external" servertype and it is working for you, then you can safely ignore this message. ');
        }

        let validationResponse: string = null;
        /* config.servertype was already checked in resolveDebugConfiguration */
        validationResponse = null;
        if (validationResponse) {
            vscode.window.showErrorMessage(validationResponse);
            return undefined;
        }

        return config;
    }

    private static adjustStrIntProp(obj: object, prop: string, where: string) {
        if (!(prop in obj)) {
            return;
        }
        let val: any = obj[prop];
        if (val) {
            let isIntString = false;
            if (typeof val === 'string') {
                val = val.trim();
                isIntString = (val.match(/^0[x][0-9a-f]+/i) || val.match(/^[0-9]+/));
            }
            if (isIntString) {
                obj[prop] = parseInt(val);
            } else if (typeof obj[prop] !== 'number') {
                vscode.window.showErrorMessage(`Invalid "${prop}" value ${val} for ${where}. Must be a number or a string." +
                    " Use a string starting with "0x" for a hexadecimal number`);
                delete obj[prop];
            }
        }
    }

    private validateLoadAndSymbolFiles(config: vscode.DebugConfiguration, cwd: string) {
        // Right now, we don't consider a bad executable as fatal. Technically, you don't need an executable but
        // users will get a horrible debug experience ... so many things don't work.
        if (config.executable) {
            let exe = config.executable;
            exe = path.isAbsolute(exe) ? exe : path.join(cwd || '.', exe);
            config.executable = path.normalize(exe).replace(/\\/g, '/');
        }
        const def = defSymbolFile(config.executable);
        const symFiles: SymbolFile[] = config.symbolFiles?.map((v) => typeof v === 'string' ? defSymbolFile(v) : v as SymbolFile) || [def];
        if (!symFiles || (symFiles.length === 0)) {
            vscode.window.showWarningMessage('No "executable" or "symbolFiles" specified. We will try to run program without symbols');
        } else {
            for (const symF of symFiles) {
                let exe = symF.file;
                exe = path.isAbsolute(exe) ? exe : path.join(cwd, exe);
                exe = path.normalize(exe).replace(/\\/g, '/');
                if (!config.symbolFiles) {
                    config.executable = exe;
                } else {
                    symF.file = exe;
                }
                CortexDebugConfigurationProvider.adjustStrIntProp(symF, 'offset', `file ${exe}`);
                CortexDebugConfigurationProvider.adjustStrIntProp(symF, 'textaddress', `file ${exe}`);
                symF.sectionMap = {};
                symF.sections = symF.sections || [];
                for (const section of symF.sections) {
                    CortexDebugConfigurationProvider.adjustStrIntProp(section, 'address', `section ${section.name} of file ${exe}`);
                    symF.sectionMap[section.name] = section;
                }
                validateELFHeader(exe, (str: string, fatal: boolean) => {
                    if (fatal) {
                        vscode.window.showErrorMessage(str);
                    } else {
                        // vscode.window.showWarningMessage(str);
                    }
                });
            }
            if (config.symbolFiles) {
                config.symbolFiles = symFiles;
            }
        }

        if (config.loadFiles) {
            for (let ix = 0; ix < config.loadFiles.length; ix++) {
                let fName = config.loadFiles[ix];
                fName = path.isAbsolute(fName) ? fName : path.join(cwd, fName);
                fName = path.normalize(fName).replace(/\\/g, '/');
                config.loadFiles[ix] = fName;
            }
        } else if (config.executable && config.symbolFiles) {
            // This is a special case when you have symbol files, we don't pass anything to gdb on the command line
            // and a target load will fail. Create a loadFiles from the executable if it exists.
            config.loadFiles = [config.executable];
        }
    }

    private handleChainedInherits(config: vscode.DebugConfiguration, parent: any, props: string[]) {
        if (!props) {
            return;
        }
        const blackList: string[] = [
            'type',
            'name',
            'request',
            'chainedConfigurations'
        ];

        for (const propName of props) {
            if (blackList.includes(propName) || propName.startsWith('pvt')) {
                vscode.window.showWarningMessage(
                    `Cannot inherit property '${propName}' for configuration '${config.name}' `
                    + `because it is reserved`);
                continue;
            }
            const val = parent[propName];
            if (val !== undefined) {
                config[propName] = val;
            } else {
                vscode.window.showWarningMessage(
                    `Cannot inherit property '${propName}' for configuration '${config.name}' `
                    + `because it does not exist in parent configuration`);
            }
        }
    }

    private handleChainedOverrides(config: vscode.DebugConfiguration, props: any) {
        if (!props) {
            return;
        }
        const blackList: string[] = [
            'type',
            'name',
            'request'
        ];

        for (const propName of Object.keys(props)) {
            if (blackList.includes(propName) || propName.startsWith('pvt')) {
                continue;
            }
            const val = props[propName];
            if (val === null) {
                delete config[propName];
            } else {
                config[propName] = val;
            }
        }
    }

    private sanitizeChainedConfigs(config: vscode.DebugConfiguration) {
        // First are we chained ... as in do we have a parent?
        const isChained = CDebugChainedSessionItem.FindByName(config.name);
        if (isChained) {
            config.pvtParent = isChained.parent.config;
            config.pvtMyConfigFromParent = isChained.config;
            this.handleChainedInherits(config, config.pvtParent, isChained.config.inherits);
            this.handleChainedOverrides(config, isChained.config.overrides);
        }

        // See if we gave children and sanitize them
        const chained = config.chainedConfigurations as ChainedConfigurations;
        if (!chained || !chained.enabled || !chained.launches || (chained.launches.length === 0)) {
            config.chainedConfigurations = { enabled: false };
            return;
        }
        if (!chained.delayMs) { chained.delayMs = 0; }
        if (!chained.waitOnEvent || !Object.values(ChainedEvents).includes(chained.waitOnEvent)) {
            chained.waitOnEvent = ChainedEvents.POSTINIT;
        }
        if ((chained.detached === undefined) || (chained.detached === null)) {
            chained.detached = (config.servertype === 'jlink') ? true : false;
        }
        if ((chained.lifecycleManagedByParent === undefined) || (chained.lifecycleManagedByParent === null)) {
            chained.lifecycleManagedByParent = true;
        }
        const overrides = chained.overrides || {};
        for (const launch of chained.launches) {
            if ((launch.enabled === undefined) || (launch.enabled === null)) {
                launch.enabled = true;
            }
            if (launch.delayMs === undefined) {
                launch.delayMs = chained.delayMs;
            }
            if ((launch.detached === undefined) || (launch.detached === null)) {
                launch.detached = chained.detached;
            }
            if ((launch.waitOnEvent === undefined) || !Object.values(ChainedEvents).includes(launch.waitOnEvent)) {
                launch.waitOnEvent = chained.waitOnEvent;
            }
            if ((launch.lifecycleManagedByParent === undefined) || (launch.lifecycleManagedByParent === null)) {
                launch.lifecycleManagedByParent = chained.lifecycleManagedByParent;
            }
            const inherits = (launch.inherits || []).concat(chained.inherits || []);
            if (inherits.length > 0) {
                launch.inherits = inherits;
            } else {
                delete launch.inherits;
            }

            const tmp = launch.overrides || {};
            if ((Object.keys(overrides).length > 0) || (Object.keys(tmp).length > 0)) {
                launch.overrides = Object.assign(overrides, tmp);
            } else {
                delete launch.overrides;
            }
        }
    }

    private setOsSpecficConfigSetting(config: vscode.DebugConfiguration, dstName: string, propName: string = '') {
        if (!config[dstName]) {
            propName = propName || dstName;
            const settings = vscode.workspace.getConfiguration('cortex-debug');
            const obj = settings[propName];
            if ((obj !== undefined) && (obj !== null)) {
                if (typeof obj === 'object') {
                    const osName = os.platform();
                    const osOverride = ((osName === 'win32') ? 'windows' : (osName === 'darwin') ? 'osx' : 'linux');
                    const val = obj[osOverride];
                    if (val !== undefined) {
                        config[dstName] = obj[osOverride];
                    }
                } else {
                    config[dstName] = obj;
                }
            }
        }
    }

    private verifyQEMUConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        this.setOsSpecficConfigSetting(config, 'serverpath', 'qemupath');
        // if (config.qemupath && !config.serverpath) { config.serverpath = config.qemupath; }

        if (!config.cpu) { config.cpu = 'cortex-m3'; }
        if (!config.machine) { config.machine = 'lm3s6965evb'; }

        if (config.swoConfig.enabled) {
            vscode.window.showWarningMessage('SWO support is not available when using QEMU.');
            config.swoConfig = { enabled: false, ports: [], cpuFrequency: 0, swoFrequency: 0 };
            config.graphConfig = [];
        }

        if (config.rtos && VALID_RTOS.indexOf(config.rtos) === -1) {
            return `Invalid RTOS value "${config.rtos}". Supported values: ${VALID_RTOS.join(', ')}`;
        }

        return null;
    }

    private verifyBMPConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (!config.BMPGDBSerialPort) { return 'A Serial Port for the Black Magic Probe GDB server is required.'; }
        if (!config.powerOverBMP) { config.powerOverBMP = 'lastState'; }
        if (!config.interface) { config.interface = 'swd'; }
        if (!config.targetId) { config.targetId = 1; }

        if (config.rtos && VALID_RTOS.indexOf(config.rtos) === -1) {
            return `Invalid RTOS value "${config.rtos}". Supported values: ${VALID_RTOS.join(', ')}`;
        }

        return null;
    }

    private verifyExternalConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): string {
        if (config.swoConfig.enabled) {
            if (config.swoConfig.source === 'socket' && !config.swoConfig.swoPort) {
                vscode.window.showWarningMessage('SWO source type "socket" requires a "swoPort". Disabling SWO support.');
                config.swoConfig = { enabled: false };
                config.graphConfig = [];
            } else if (config.swoConfig.source !== 'socket' && !config.swoConfig.swoPath) {
                vscode.window.showWarningMessage(`SWO source type "${config.swoConfig.source}" requires a "swoPath". Disabling SWO support.`);
                config.swoConfig = { enabled: false };
                config.graphConfig = [];
            }
        }

        if (!config.gdbTarget) {
            return 'External GDB server type must specify the GDB target. This should either be a "hostname:port" combination or a serial port.';
        }

        if (config.rtos && VALID_RTOS.indexOf(config.rtos) === -1) {
            return `Invalid RTOS value "${config.rtos}". Supported values: ${VALID_RTOS.join(', ')}`;
        }

        return null;
    }
}
