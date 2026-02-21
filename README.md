# BMP Debug

A VS Code extension for debugging ARM microcontrollers using the [Black Magic Probe](https://black-magic.org/) with [Zephyr RTOS](https://zephyrproject.org/) thread awareness support.

This extension is a fork of [Cortex-Debug](https://github.com/Marus/cortex-debug) by Marus (marus25), stripped down and focused specifically on **Black Magic Probe (BMP)** workflows. Full credit and attribution to the original Cortex-Debug project and its contributors.

## Features

- Black Magic Probe GDB server integration
- Zephyr RTOS thread awareness in the Call Stack view
- SWO decoding (console, binary, graphing)
- SEGGER RTT support
- Live Watch for global/static variables
- Memory viewing via [mcu-debug extensions](https://marketplace.visualstudio.com/search?term=mcu-debug&target=VSCode&category=All%20categories&sortBy=Relevance)
- Disassembly debugging (provided by VS Code)
- Also supports QEMU and external GDB server types

## Requirements

- ARM GCC Toolchain ([download](https://developer.arm.com/open-source/gnu-toolchain/gnu-rm/downloads)) — provides `arm-none-eabi-gdb` and related tools
- A Black Magic Probe (or compatible device)

## Quick Start

Add the following to your `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug with BMP",
            "cwd": "${workspaceFolder}",
            "executable": "./build/zephyr/zephyr.elf",
            "request": "launch",
            "type": "bmp-debug",
            "servertype": "bmp",
            "BMPGDBSerialPort": "/dev/ttyACM0",
            "interface": "swd",
            "runToEntryPoint": "main",
            "rtos": "zephyr"
        }
    ]
}
```

On Windows, set `"BMPGDBSerialPort"` to the appropriate COM port (e.g., `"COM3"`).

### Key launch.json Properties

| Property | Description |
|---|---|
| `BMPGDBSerialPort` | Serial port for BMP GDB server (required) |
| `interface` | Debug interface: `"swd"` (default) or `"jtag"` |
| `targetId` | Target ID for BMP scan (default: `1`) |
| `powerOverBMP` | Power target via BMP: `"enable"`, `"disable"`, or `"lastState"` (default) |
| `rtos` | RTOS type for thread awareness. Currently only `"zephyr"` is supported |
| `rttEnabled` | Enable RTT support over BMP (adds `monitor rtt enable`) |
| `runToEntryPoint` | Function name to run to on launch (e.g., `"main"`) |

For a full list of properties, see [debug_attributes.md](debug_attributes.md).

## Acknowledgments

This extension is based on [Cortex-Debug](https://github.com/Marus/cortex-debug) by Marus (marus25). The original project is licensed under the MIT License.

Parts of the original Cortex-Debug extension are based upon Jan Jurzitza's (WebFreak) [code-debug](https://github.com/WebFreak001/code-debug) extension, which provided an excellent base for GDB MI parsing and interaction.

The [mcu-debug](https://github.com/mcu-debug) extensions (Memory Viewer, RTOS Views, Peripheral Viewer) are used for frontend debug views.
