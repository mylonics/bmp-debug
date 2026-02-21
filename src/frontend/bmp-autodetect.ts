import * as vscode from 'vscode';

/** Black Magic Probe USB identifiers */
const BMP_VID = '1d50';
const BMP_PID = '6018';

export interface BMPPortInfo {
    /** The system path for this port (e.g. COM3, /dev/ttyACM0) */
    path: string;
    /** Friendly name or description if available */
    friendlyName?: string;
    /** The serial number of the device (can distinguish multiple probes) */
    serialNumber?: string;
    /** The USB interface number (MI_00 = GDB, MI_01 = UART) */
    pnpId?: string;
}

/**
 * Detects Black Magic Probe serial ports by scanning for devices
 * matching VID 1d50 and PID 6018.
 *
 * Returns only the GDB Server ports (Interface 0 / MI_00).
 * The ports are sorted by path so the first entry is deterministic.
 */
export async function detectBMPPorts(): Promise<BMPPortInfo[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SerialPort } = require('serialport');
        const allPorts: any[] = await SerialPort.list();

        // Filter for BMP by VID/PID (case-insensitive comparison)
        const bmpPorts = allPorts.filter((p: any) => {
            const vid = (p.vendorId || '').toLowerCase();
            const pid = (p.productId || '').toLowerCase();
            return vid === BMP_VID && pid === BMP_PID;
        });

        if (bmpPorts.length === 0) {
            return [];
        }

        // On most systems the BMP exposes two serial ports:
        //   - Interface 0 (MI_00): GDB Server
        //   - Interface 1 (MI_01): UART Console
        //
        // We want the GDB server port. Heuristics:
        //   Windows: pnpId contains "MI_00" for GDB
        //   Linux:   /dev/ttyACM0 (lower number) is GDB, ttyACM1 is UART
        //   macOS:   similar path-ordering behaviour
        //
        // Strategy: first try to identify by pnpId (MI_00), then fall back
        // to picking the port with the lower/first path (sorted).

        const gdbPorts = bmpPorts.filter((p: any) => {
            const pnpId = (p.pnpId || '').toUpperCase();
            return pnpId.includes('MI_00') || pnpId.includes('MI#00');
        });

        let resultPorts: any[];
        if (gdbPorts.length > 0) {
            resultPorts = gdbPorts;
        } else {
            // Fallback: group by serial number and pick the first port in each group
            const bySerial = new Map<string, any[]>();
            for (const p of bmpPorts) {
                const key = p.serialNumber || '_default';
                if (!bySerial.has(key)) { bySerial.set(key, []); }
                bySerial.get(key)?.push(p);
            }
            resultPorts = [];
            for (const [, ports] of bySerial) {
                ports.sort((a: any, b: any) => (a.path as string).localeCompare(b.path as string));
                resultPorts.push(ports[0]); // First port (lower number) is GDB
            }
        }

        // Sort deterministically by path
        resultPorts.sort((a: any, b: any) => (a.path as string).localeCompare(b.path as string));

        return resultPorts.map((p: any) => ({
            path: p.path,
            friendlyName: p.friendlyName || p.manufacturer,
            serialNumber: p.serialNumber,
            pnpId: p.pnpId
        }));
    } catch (e) {
        console.error('BMP auto-detect failed:', e);
        return [];
    }
}

/**
 * Auto-detect a Black Magic Probe GDB serial port.
 *
 * - If exactly one probe is found, returns its GDB port path.
 * - If multiple probes are found, shows a quick-pick so the user can choose.
 * - If none are found, returns undefined.
 */
export async function autoDetectBMPPort(): Promise<string | undefined> {
    const ports = await detectBMPPorts();

    if (ports.length === 0) {
        return undefined;
    }

    if (ports.length === 1) {
        return ports[0].path;
    }

    // Multiple probes found – let the user choose
    const items: vscode.QuickPickItem[] = ports.map((p) => ({
        label: p.path,
        description: p.serialNumber ? `S/N: ${p.serialNumber}` : undefined,
        detail: p.friendlyName || 'Black Magic Probe'
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Multiple Black Magic Probes detected – select the GDB serial port',
        canPickMany: false
    });

    return picked?.label;
}

/**
 * Detect the BMP UART/RTT serial port (Interface 1 / MI_01) given the GDB serial port path.
 *
 * Strategy:
 *   1. Scan all BMP ports and find one with MI_01 / MI#01 that shares the same serialNumber.
 *   2. Fallback: increment the numeric suffix of the GDB port path
 *      (e.g. COM3 → COM4, /dev/ttyACM0 → /dev/ttyACM1).
 *   3. Verify the candidate port actually exists before returning.
 */
export async function detectBMPUartPort(gdbPort: string): Promise<string | undefined> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SerialPort } = require('serialport');
        const allPorts: any[] = await SerialPort.list();

        console.log(`BMP RTT: Searching for UART port. GDB port = "${gdbPort}". `
            + `System has ${allPorts.length} serial port(s).`);
        for (const p of allPorts) {
            console.log(`  port: ${p.path}  vid=${p.vendorId}  pid=${p.productId}`
                + `  pnpId=${p.pnpId}  sn=${p.serialNumber}`);
        }

        // Find the GDB port entry — compare case-insensitively on Windows
        const pathEq = (a: string, b: string) => {
            if (process.platform === 'win32') {
                return a.toLowerCase() === b.toLowerCase();
            }
            return a === b;
        };
        const gdbEntry = allPorts.find((p: any) => pathEq(p.path, gdbPort));
        const gdbSerial = gdbEntry?.serialNumber;
        console.log(`BMP RTT: GDB entry serialNumber = "${gdbSerial ?? '(not found)'}"`);

        // Filter for BMP devices
        const bmpPorts = allPorts.filter((p: any) => {
            const vid = (p.vendorId || '').toLowerCase();
            const pid = (p.productId || '').toLowerCase();
            return vid === BMP_VID && pid === BMP_PID;
        });
        console.log(`BMP RTT: Found ${bmpPorts.length} BMP port(s).`);

        // Strategy 1: Look for MI_01 port with same serialNumber
        if (gdbSerial) {
            const uartPort = bmpPorts.find((p: any) => {
                const pnpId = (p.pnpId || '').toUpperCase();
                return (pnpId.includes('MI_01') || pnpId.includes('MI#01'))
                    && p.serialNumber === gdbSerial;
            });
            if (uartPort) {
                console.log(`BMP RTT: Strategy 1 matched UART port: ${uartPort.path}`);
                return uartPort.path as string;
            }
        }

        // Strategy 2: Look for any MI_01 port from same BMP (by grouping)
        const uartPorts = bmpPorts.filter((p: any) => {
            const pnpId = (p.pnpId || '').toUpperCase();
            return pnpId.includes('MI_01') || pnpId.includes('MI#01');
        });
        if (uartPorts.length === 1) {
            console.log(`BMP RTT: Strategy 2 matched single UART port: ${uartPorts[0].path}`);
            return uartPorts[0].path as string;
        }

        // Strategy 3: Fallback — pick the "other" BMP port that isn't the GDB port
        const otherBmpPorts = bmpPorts.filter((p: any) => !pathEq(p.path, gdbPort));
        if (otherBmpPorts.length === 1) {
            console.log(`BMP RTT: Strategy 3a matched other BMP port: ${otherBmpPorts[0].path}`);
            return otherBmpPorts[0].path as string;
        }

        // Strategy 4: Fallback – increment numeric suffix of the GDB port path
        const match = gdbPort.match(/^(.*?)(\d+)$/);
        if (match) {
            const prefix = match[1];
            const num = parseInt(match[2], 10);
            const candidate = `${prefix}${num + 1}`;
            // Verify the candidate exists in the system port list
            const exists = allPorts.find((p: any) => pathEq(p.path, candidate));
            if (exists) {
                console.log(`BMP RTT: Strategy 4 (path increment) matched: ${candidate}`);
                return candidate;
            }
        }

        console.log('BMP RTT: No UART port found by any strategy.');
        return undefined;
    } catch (e) {
        console.error('BMP UART port detection failed:', e);
        return undefined;
    }
}
