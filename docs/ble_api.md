# IndiaNavi Bluetooth LE API

Status: version 1, implemented in the firmware (`src/esp32/ble.c`, `src/esp32/ble_ota.c`, encoding in
`lib/ble_protocol`) and in the app (`modules/ble/`).

The IndiaNavi is a Bluetooth LE peripheral. It is visible as long as it is switched on, independent of the
WiFi access point, which switches itself off when nobody uses it. Only the ESP32-S3 board has Bluetooth.
In the off state (the off screen) Bluetooth is off, too. It starts again when the device is switched on.

The phone can use Bluetooth to

- set the time and tell the position, so the GPS module finds the satellites faster,
- read the position of the device,
- switch the WiFi access point on and off,
- show or hide the track and the height graph, choose the color of the track and set how often the screen is
  updated,
- update the firmware.

Files (tiles and track) are still sent over WiFi, see `wifi_upload_api.md`.

## Pairing and security

- One phone can be paired. The device uses LE Secure Connections with a passkey: it shows a **six digit code in a
  box in the middle of its display**, the phone asks the user to type it in (Android does this when the app first
  reads a protected value).
- All values need an encrypted and authenticated link. Without pairing, the phone can only see the advertisement.
- While a phone is connected, no other phone can connect, because the device allows one connection.
- A new phone can pair
  - while no phone is paired,
  - for two minutes after Bluetooth started (switching the device on),
  - for two minutes after the app wrote `0x01` to *Device control* ("pair another phone"). The device forgets the
    paired phone and disconnects.

  A pairing outside of these times is refused without showing a code. A new pairing replaces the old one.
- The WiFi password is **never** sent over Bluetooth. The WiFi access point can be switched on and off and its
  name is reported, but the phone has to read the password from the QR code on the display (as before).

Advertising: connectable, interval 500 to 600 ms, the 128 bit service UUID in the advertisement and the name
`IndiaNavi-XXXX` (the same suffix as the WiFi access point) in the scan response.

## Service and characteristics

Base UUID: `494e4449-00NN-4e41-5649-000000000000` ("INDI" "NAVI"). The service is `NN = 01`.
All numbers are little endian.

| `NN` | Name | Properties | Value |
|---|---|---|---|
| 02 | Info | read | api, flags, battery, firmware (4 bytes + text) |
| 03 | Time | read, write | seconds since 1970-01-01 UTC, u64 (8 bytes) |
| 04 | Position in | write | position of the phone (16 bytes) |
| 05 | Position out | read, notify | position of the device (16 bytes) |
| 06 | WiFi control | write | 0 = access point off, 1 = on (1 byte) |
| 07 | WiFi status | read, notify | running, stations, SSID (2 bytes + text) |
| 08 | Settings | read, write | flags, update interval (4 bytes) |
| 09 | OTA control | read, write, notify | commands and status of a firmware update |
| 0a | OTA data | write without response | chunks of the firmware image |
| 0b | Device control | write | `0x01` = forget the phone |

A write with a wrong length is answered with the ATT error *Invalid Attribute Value Length* (0x0d), a value that
is not allowed (outside of a range, reserved bits set, unknown command) with *Value Not Allowed* (0x13).

### Info (02)

| Byte | Content |
|---|---|
| 0 | API version, 1 |
| 1 | flags: bit 0 = firmware update supported, bit 1 = charger connected, bit 2 = track color in the settings |
| 2 | battery in percent |
| 3 | 0 |
| 4… | firmware version (text, not terminated) |

The app checks the API version and refuses a device with another one.

### Time (03)

Write: the time of the phone as seconds since 1970-01-01 UTC. Values before 2026-01-01 and after 2100-01-01
are refused. The device sets its clock and tells the time to the GPS module (`PMTK740`). It ignores the write
(without an error) when the GPS module already has a fix, because the time of the satellites is exact. The app
sends the time right after connecting.

### Position in (04)

The position of the phone, written by the app (for example from `expo-location`).

| Bytes | Content |
|---|---|
| 0–3 | latitude in degrees × 10⁷, i32 |
| 4–7 | longitude in degrees × 10⁷, i32 |
| 8–9 | altitude in meters, i16 |
| 10–11 | accuracy (radius in meters), u16, not 0 |
| 12–15 | time of the measurement, seconds since 1970-01-01 UTC, u32 |

The device gives the position and the time to its GPS module (`PMTK741`), so it starts with a good guess instead
of searching the whole sky. Until the module has a fix of its own, the device uses the position of the phone for
the map and reports it with fix type 7. It is never written to the track log. The first GPS fix replaces it.
It is ignored when the module already has a fix.

### Position out (05)

| Bytes | Content |
|---|---|
| 0–3 | latitude in degrees × 10⁷, i32 |
| 4–7 | longitude in degrees × 10⁷, i32 |
| 8–9 | altitude in meters, i16 |
| 10–11 | HDOP × 10, u16 |
| 12 | fix: 0 none, 1 GPS, 2 DGPS, 6 dead reckoning, 7 position of the phone |
| 13 | satellites in use |
| 14 | satellites in view |
| 15 | 0 |

Notified about every 5 seconds while the phone is subscribed and the device has a position. The values are the
ones the map screen uses. A fix of 0 means the device has no position.

### WiFi control (06) and status (07)

Write 1 to start the WiFi access point, 0 to stop it. The display then shows or removes the QR code. The status
changes (and is notified) when the access point started or stopped and when a phone joined or left it.

| Byte | Content |
|---|---|
| 0 | access point running, 0/1 |
| 1 | number of phones that joined |
| 2… | SSID, for example `IndiaNavi-E3ED` (text) |

### Settings (08)

| Byte | Content |
|---|---|
| 0 | flags: bit 0 = show the track, bit 1 = show the height graph. Other bits have to be 0 |
| 1 | color of the track + 1, 0 = default (blue) |
| 2–3 | update interval of the screen in seconds, u16, **30 to 600** |

The interval is the time between two automatic updates of the screen (the e-ink display needs about 20 seconds
for one update). Updates that something triggers, such as a button, the WiFi QR code, the pairing code or the
progress of a transfer, are not delayed by it. The default is 60 seconds, track and height graph are shown by
default. The settings are stored in NVS and survive a restart. With the height graph hidden, the scale and the
copyright line move down.

The track color is a color of the display: 0 black, 1 white, 2 green, 3 blue, 4 red, 5 yellow, 6 orange. The
value is that number + 1, so a 0 written by an app that does not know the color keeps the default, blue. Values
above 7 are refused. The phone only writes a color if the Info flag bit 2 is set, an older firmware refuses
anything but 0 in this byte. Reading returns the color + 1.

### Device control (0b)

`0x01`: forget the phone that is paired and allow the next one to pair for two minutes. The connection ends.

## Firmware update

The image is the `firmware.bin` of the project (the application, not the bootloader). The device writes it to
the inactive OTA partition, checks it (`esp_ota_end`: magic, checksum, hash) and boots it after the restart.
The new firmware has to run for a minute, otherwise the bootloader goes back to the old one.

### OTA control (09)

Commands (write):

| Bytes | Command |
|---|---|
| `01` + u32 size | START: size of the image in bytes |
| `02` | ABORT |
| `03` | FINISH: all bytes are sent, check the image and select it |
| `04` | RESTART: boot the new firmware (only after state DONE) |

Status (read, notify), 6 bytes: `state`, `error`, `offset` (u32, bytes that are in flash).

| State | | Meaning |
|---|---|---|
| 0 | IDLE | no update (error 10 = it was aborted) |
| 1 | READY | START accepted, send the image from offset 0 |
| 2 | RECEIVING | the offset is what is in flash |
| 3 | VERIFYING | FINISH is running, this takes some seconds |
| 4 | DONE | the image is valid and selected, RESTART boots it |
| 5 | ERROR | see error, the update is over, the old firmware stays |

| Error | Meaning |
|---|---|
| 1 | busy (another update or a WiFi transfer) |
| 2 | image is empty or does not fit into the partition (6.25 MiB) |
| 3 | battery under 30 % and no charger |
| 4 | link too slow (MTU under 185) |
| 5 | flash error |
| 6 | image rejected by the check |
| 7 | sequence error (command in the wrong state, more data than announced, FINISH before all data was stored) |
| 8 | no data for 120 s |
| 9 | the phone sent more than the window without waiting |
| 10 | aborted |

A START while another update is running is answered with *Value Not Allowed*.

### OTA data (0a)

Chunks of the image in order, written without response. The size of a chunk is `min(MTU - 3, 244)`. There is no
offset in a chunk, the link keeps the order. A final check of the whole image catches lost data.

### Flow control

The Bluetooth host task only puts the chunks into a 16 KiB buffer, a task of its own writes them to flash in
pieces of 4096 bytes (a sector erase can take up to 400 ms). After every piece the device notifies
`RECEIVING` with the new offset. A rest smaller than 4096 bytes is written when nothing arrived for 200 ms.

**The phone never sends more than 8192 bytes beyond the last reported offset.** It waits for the next report when
the window is full. With an 8 KiB window the buffer can never overflow.

### Sequence

1. Read the status. DONE: send RESTART, finished. READY, RECEIVING or VERIFYING (an earlier try): send ABORT and
   wait for IDLE.
2. Request the highest connection priority and an MTU of 247. Refuse to start below 185.
3. Write START, wait for READY.
4. Send chunks and obey the window until the offset is the size of the image.
5. Write FINISH, wait for DONE (up to a minute).
6. Write RESTART. The device restarts after half a second and the link ends.

A disconnect does not end the update at once: the device waits 120 seconds, writes what it has and then aborts.
The app starts again with step 1.

### How long does it take?

The partition is 0x640000 = 6,553,600 bytes, a typical image is 1.5 to 2 MB.

| Case | Throughput | 2 MB | 6.5 MB |
|---|---|---|---|
| no MTU/DLE (refused, MTU under 185) | 2.7 kB/s | 13 min | 41 min |
| slow flash (400 ms erase) | about 10 kB/s | 3.5 min | 11 min |
| MTU 185, 2 packets per 30 ms | about 12 kB/s | 3 min | 9 min |
| typical Android (MTU 247, DLE, 1M PHY) | about 40 kB/s | 52 s | 2.7 min |
| flash limit with a fast link | about 70 kB/s | 30 s | 94 s |

### Progress on the display

The e-ink display needs about 16 to 20 s per update. The device decides when the update starts: it estimates the
time as size ÷ 40 kB/s and shows a progress box from the start if that is more than 15 seconds (images over
600 kB, practically always). An update that is still running after 15 s shows it as well. The box changes in
steps of 10 %, but not more often than every 30 s. A failed update shows "Firmware update failed" once. A
successful one shows nothing more, the new firmware draws its own screen.
