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
        const port = ports[0];
        vscode.window.showInformationMessage(
            `Black Magic Probe auto-detected on ${port.path}`
        );
        return port.path;
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
