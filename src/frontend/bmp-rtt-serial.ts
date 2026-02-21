import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type { SerialPort as SerialPortType } from 'serialport';
import { IPtyTerminalOptions, magentaWrite, PtyTerminal } from './pty';
import { TerminalInputMode } from '../common';
import { RESET } from './ansi-helpers';

/**
 * Opens the BMP's second serial port (UART / RTT) and displays incoming data
 * in a VS Code pseudo-terminal panel.  User input typed into the terminal is
 * forwarded back to the serial port, so it works as a bidirectional console.
 */
export class BMPRttSerialTerminal extends EventEmitter {
    private serialPort: SerialPortType | null = null;
    private ptyTerm: PtyTerminal;
    private disposed = false;

    /**
     * @param portPath  System path of the UART serial port (e.g. COM4, /dev/ttyACM1)
     * @param baudRate  Baud rate – defaults to 115200 which is the most common RTT/UART rate
     */
    constructor(
        private readonly portPath: string,
        private readonly baudRate: number = 115200
    ) {
        super();

        const ptyOpts: IPtyTerminalOptions = {
            name: `BMP RTT: ${portPath}`,
            prompt: '',
            inputMode: TerminalInputMode.RAW
        };
        this.ptyTerm = new PtyTerminal(ptyOpts);
        this.ptyTerm.on('data', (data: string | Buffer) => {
            this.sendToSerial(data);
        });
        this.ptyTerm.on('close', () => {
            this.dispose();
        });

        this.openSerial();
    }

    public get terminal(): vscode.Terminal | null {
        return this.ptyTerm?.terminal ?? null;
    }

    /** Show the terminal panel to the user. */
    public show(): void {
        this.ptyTerm?.terminal?.show(true);     // preserveFocus = true
    }

    private openSerial(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { SerialPort } = require('serialport');
            this.serialPort = new SerialPort({
                path: this.portPath,
                baudRate: this.baudRate,
                autoOpen: false
            });

            this.serialPort.on('data', (buf: Buffer) => {
                // Forward received bytes to the pseudo-terminal
                this.ptyTerm.write(buf.toString('utf8'));
            });

            this.serialPort.on('error', (err: any) => {
                if (!this.disposed) {
                    magentaWrite(`\r\nSerial port error (${this.portPath}): ${err.message}\r\n`, this.ptyTerm);
                }
            });

            this.serialPort.on('close', () => {
                if (!this.disposed) {
                    this.ptyTerm.write(RESET + '\r\n');
                    magentaWrite(`Serial port ${this.portPath} closed.\r\n`, this.ptyTerm);
                }
            });

            this.serialPort.on('open', () => {
                magentaWrite(`Connected to BMP UART/RTT on ${this.portPath} @ ${this.baudRate} baud\r\n`, this.ptyTerm);
                this.emit('connected');
            });

            this.serialPort.open((err?: Error | null) => {
                if (err) {
                    magentaWrite(`Failed to open ${this.portPath}: ${err.message}\r\n`, this.ptyTerm);
                }
            });
        } catch (e: any) {
            magentaWrite(`Cannot load serialport module: ${e.message}\r\n`, this.ptyTerm);
        }
    }

    private sendToSerial(data: string | Buffer): void {
        if (this.serialPort && this.serialPort.isOpen) {
            try {
                const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
                this.serialPort.write(buf);
            } catch (e: any) {
                console.error(`BMPRttSerialTerminal: write failed – ${e.message}`);
            }
        }
    }

    /** Close just the serial port, leaving the terminal open for the user. */
    public closeSerial(): void {
        try {
            if (this.serialPort?.isOpen) {
                this.serialPort.close();
            }
        } catch { /* ignore */ }
        this.serialPort = null;

        if (!this.disposed) {
            this.ptyTerm.write(RESET + '\r\n');
            magentaWrite('Debug session ended. Serial port closed.\r\n', this.ptyTerm);
        }
    }

    /** Tear down the serial port and terminal. */
    public dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;

        try {
            if (this.serialPort?.isOpen) {
                this.serialPort.close();
            }
        } catch { /* ignore */ }
        this.serialPort = null;

        this.ptyTerm?.dispose();
        this.emit('disposed');
    }
}
