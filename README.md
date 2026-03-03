# BMP Debug

A VS Code extension for debugging ARM microcontrollers using the [Black Magic Probe](https://black-magic.org/) with [Zephyr RTOS](https://zephyrproject.org/) thread awareness support.

This extension is a fork of [Cortex-Debug](https://github.com/Marus/cortex-debug) by Marus (marus25), stripped down and focused specifically on **Black Magic Probe (BMP)** workflows. Full credit and attribution to the original Cortex-Debug project and its contributors.

## Features

- Black Magic Probe GDB server integration
- **USB auto-detection** — automatically finds the BMP by VID/PID (`1d50:6018`), no manual port configuration needed
- **RTT over BMP serial** — opens the BMP's second serial port (UART/RTT) in a dedicated terminal panel when `rttEnabled` is set
- Zephyr RTOS thread awareness in the Call Stack view
- SWO decoding (console, binary, graphing)
- SEGGER RTT support
- Memory viewing via [mcu-debug extensions](https://marketplace.visualstudio.com/search?term=mcu-debug&target=VSCode&category=All%20categories&sortBy=Relevance)
- Disassembly debugging (provided by VS Code)

> **Currently only Black Magic Probe and Zephyr RTOS thread awareness are supported.**
> QEMU and external GDB server types are available but without thread awareness.
> If you would like to add support for another GDB server without thread awareness, please open a PR.
> If you would like to support another RTOS besides Zephyr, please open an issue or PR.

## Requirements

- **`arm-none-eabi-gdb` 12.1 or greater with Python support** — the version of Python that `arm-none-eabi-gdb` was compiled against must also be installed on your system (the Zephyr SDK includes a compatible toolchain by default)
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
            "interface": "swd",
            "runToEntryPoint": "main",
            "rtos": "zephyr"
        }
    ]
}
```

### USB Auto-Detection

The extension **automatically detects** a connected Black Magic Probe by scanning USB devices for VID `1d50` and PID `6018`. The BMP exposes two serial ports:

| Interface | Purpose |
|---|---|
| Interface 0 (`MI_00`) | GDB Server |
| Interface 1 (`MI_01`) | UART Console / RTT |

The GDB port (Interface 0) is identified by its USB interface descriptor (`MI_00`). If the descriptor is unavailable, the extension falls back to choosing the lower-numbered port path (e.g. `COM3` before `COM4`, or `/dev/ttyACM0` before `/dev/ttyACM1`).

If multiple probes are connected you will be prompted to choose one.
You can still override the port manually by adding `"port": "/dev/ttyACM0"` (Linux/macOS) or `"port": "COM3"` (Windows) to your configuration.

### RTT over BMP Serial

When `"rttEnabled": true` is set in your launch configuration, the extension automatically:

1. Sends `monitor rtt enable` to the BMP before launch/attach
2. Detects the BMP's second serial port (UART/RTT interface, `MI_01`)
3. Opens that port at **115200 baud** in a new VS Code terminal panel titled **"BMP RTT: \<port\>"**

The UART port is detected using these strategies (in order):
- **USB interface descriptor** — looks for `MI_01` with the same serial number as the GDB port
- **Single UART port** — if only one BMP UART port is found, uses it directly
- **Path increment** — increments the numeric suffix of the GDB port (e.g. `COM3` → `COM4`, `/dev/ttyACM0` → `/dev/ttyACM1`) and verifies it exists

The RTT terminal is bidirectional — you can both view output and send input. It is automatically closed when the debug session ends.

#### Example configuration with RTT

```json
{
    "name": "Debug with RTT",
    "cwd": "${workspaceFolder}",
    "executable": "./build/zephyr/zephyr.elf",
    "request": "launch",
    "type": "bmp-debug",
    "interface": "swd",
    "runToEntryPoint": "main",
    "rtos": "zephyr",
    "rttEnabled": true
}
```

### Specifying the GDB Executable

The extension needs `arm-none-eabi-gdb` (with Python support) to communicate with the Black Magic Probe. There are several ways to configure which GDB binary is used, listed in order of precedence:

1. **`gdbPath` in launch.json** — overrides everything for that launch configuration. Can be a full path or just the executable name if it is on your `PATH`.
2. **`armToolchainPath` in launch.json** — sets the directory containing the toolchain binaries. The extension appends `arm-none-eabi-gdb` (or the configured prefix) automatically.
3. **VS Code settings** — the `bmp-debug.gdbPath` or `bmp-debug.armToolchainPath` settings apply globally (with per-platform variants `.linux`, `.osx`, `.windows`).
4. **System PATH** — if none of the above are set, the extension looks for `arm-none-eabi-gdb` on your system `PATH`.


#### Example: Using `armToolchainPath` in launch.json

```json
{
    "name": "Debug with BMP",
    "cwd": "${workspaceFolder}",
    "executable": "./build/zephyr/zephyr.elf",
    "request": "launch",
    "type": "bmp-debug",
    "interface": "swd",
    "runToEntryPoint": "main",
    "rtos": "zephyr",
    "armToolchainPath": "C:/zephyr-sdk-0.17.0/arm-zephyr-eabi/bin"
    //"gdbPath": "C:/zephyr-sdk-0.17.0/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb.exe"
}
```

#### Example: Using VS Code settings

In your `.vscode/settings.json` or user settings:

```json
{
    "bmp-debug.gdbPath": "/opt/zephyr-sdk-0.17.0/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb"
}
```


### Getting a Compatible GDB for python based RTOS thread awareness

The [Zephyr SDK](https://github.com/zephyrproject-rtos/sdk-ng/releases) ships a build of `arm-zephyr-eabi-gdb` that includes **Python support** and is the easiest way to get a compatible GDB.

1. **Download the Zephyr SDK** from the [releases page](https://github.com/zephyrproject-rtos/sdk-ng/releases). You can install the full SDK or just the ARM toolchain:

   ```bash
   # Full SDK (includes all toolchains)
   wget https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v0.17.0/zephyr-sdk-0.17.0_linux-x86_64.tar.xz
   tar xf zephyr-sdk-0.17.0_linux-x86_64.tar.xz

   # Or minimal — ARM toolchain only
   wget https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v0.17.0/toolchain_linux-x86_64_arm-zephyr-eabi.tar.xz
   tar xf toolchain_linux-x86_64_arm-zephyr-eabi.tar.xz
   ```

   On Windows, download the `.7z` or installer variant and extract/install to a directory such as `C:\zephyr-sdk-0.17.0`.

2. **Locate the GDB binary** inside the extracted SDK:

   | OS | Path |
   |---|---|
   | Linux | `<sdk>/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb` |
   | macOS | `<sdk>/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb` |
   | Windows | `<sdk>\arm-zephyr-eabi\bin\arm-zephyr-eabi-gdb.exe` |

3. **Configure the extension** using one of the methods above. Since the Zephyr SDK uses the prefix `arm-zephyr-eabi` instead of the default `arm-none-eabi`, the simplest approach is to set `gdbPath` directly:

   ```json
   {
       "bmp-debug.gdbPath": "<sdk>/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb"
   }
   ```

   Alternatively, set both `armToolchainPath` and `armToolchainPrefix`:

   ```json
   {
       "bmp-debug.armToolchainPath": "<sdk>/arm-zephyr-eabi/bin",
       "bmp-debug.armToolchainPrefix": "arm-zephyr-eabi"
   }
   ```

> **Note:** The Zephyr SDK GDB requires the Python version it was compiled against to be installed on your system. If you get errors about missing Python libraries, install the matching Python version (check with `arm-zephyr-eabi-gdb --configuration` and look for the Python path).

### Key launch.json Properties

| Property | Description |
|---|---|
| `servertype` | GDB server type: `"bmp"` (default), `"qemu"`, or `"external"` |
| `port` | Serial port for BMP GDB server. Auto-detected if omitted |
| `interface` | Debug interface: `"swd"` (default) or `"jtag"` |
| `targetId` | Target ID for BMP scan (default: `1`) |
| `powerOverBMP` | Power target via BMP: `"enable"`, `"disable"`, or `"lastState"` (default) |
| `rtos` | RTOS type for thread awareness. Currently only `"zephyr"` is supported |
| `rttEnabled` | Enable RTT over BMP serial. Opens the UART port in a terminal panel and sends `monitor rtt enable` |
| `runToEntryPoint` | Function name to run to on launch (e.g., `"main"`) |
| `gdbPath` | Full path or name of the GDB executable to use (overrides `armToolchainPath`) |
| `armToolchainPath` | Path to the directory containing the ARM toolchain binaries |

For a full list of properties, see [debug_attributes.md](debug_attributes.md).

## Acknowledgments

This extension is based on [Cortex-Debug](https://github.com/Marus/cortex-debug) by Marus (marus25). The original project is licensed under the MIT License.

Parts of the original Cortex-Debug extension are based upon Jan Jurzitza's (WebFreak) [code-debug](https://github.com/WebFreak001/code-debug) extension, which provided an excellent base for GDB MI parsing and interaction.

The [mcu-debug](https://github.com/mcu-debug) extensions (Memory Viewer, RTOS Views, Peripheral Viewer) are used for frontend debug views.
