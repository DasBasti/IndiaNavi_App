# IndiaNavi WiFi upload API

Status: version 3, implemented in the firmware (`src/esp32/upload_server.c`). Version 2 adds the vector maps
(`MAPS/{name}.map`, `GET /api/maps`), version 3 uploads of maps that can be continued (`Content-Range`).
The server runs while the device is charging, because only then WiFi is on.
The device opens its own access point for the app (see "Transport").

The IndiaNavi app on the phone opens a GPX file, downloads the map tiles around
the track and converts them to the raw format of the display. This document
describes the HTTP API the device has to offer so the app can copy these files
to the SD card over WiFi.

## What gets transferred

The files have the same names and layout as on the SD card today:

| File | Content | Size |
|---|---|---|
| `track.gpx` | the GPX file the user opened | some 10 kB to a few MB |
| `MAPS/{zoom}/{x}/{y}.raw` | one map tile, 256x256 pixels, 4 bit per pixel | exactly 32768 bytes |
| `MAPS/{name}.map` | a vector map (Mapsforge), API version 2 | some 10 MB to a few GB |

- `{zoom}` is 10 to 17, the two zoom levels the user chose in the app (14 and 16 by default). `{x}` and `{y}` are the usual slippy map tile numbers in decimal.
- A typical track needs 1100 to 1700 tiles, which is 36 to 55 MB.
- `{name}` of a vector map has 1 to 8 letters, digits, `_` or `-`. The app names maps after their region and a
  number, `rheinl01.map`. The device draws all maps in `MAPS` that cover the screen (at most 4), a newer map of a
  region replaces an older one, see `Documentation/multiple_vector_maps.md` of the firmware.
- All names fit into 8.3, so FAT long file names are not needed.

## Transport

### Access point of the device (recommended)

While charging, the device opens its own WiFi network. The phone connects to it
directly, so no router is involved.

| | |
|---|---|
| SSID | `IndiaNavi-XXXX`, `XXXX` are the last 4 hex digits of the access point MAC, for example `IndiaNavi-E3ED` |
| Security | WPA2-PSK |
| Password | 12 random characters from `abcdefghjkmnpqrstuvwxyz23456789`. Created on first boot and kept, so the phone can remember the network |
| Device address | `192.168.4.1`, the device is the DHCP server of this network |
| Channel | 1, or the channel of the other WiFi if the device joined one as well |
| Clients | at most 2 at the same time |

The access point can also be switched on and off over Bluetooth (see `ble_api.md`), the password is never sent
that way, it is only on the display.

The charging screen of the device (the screen shown when the device is switched
off and plugged in) shows a QR code with the credentials in the standard WiFi
format, plus SSID and password as text:

```
WIFI:T:WPA;S:IndiaNavi-E3ED;P:<password>;;
```

The app can scan this QR code and connect to the network by itself:

- Android 10 and later: `WifiNetworkSpecifier` with the SSID and password, then
  `ConnectivityManager.requestNetwork()` and `bindProcessToNetwork()`. This network
  has no internet, so without binding, Android sends the requests over mobile data.
- iOS 11 and later: `NEHotspotConfiguration` with SSID and password.

The phone camera or the Android settings can also scan the code. Then the app
still has to make sure its requests go to the WiFi without internet.

Use `http://192.168.4.1` in this network. mDNS (`indianavi.local`) is announced
too, but not every phone resolves it on a network without internet.

### WiFi of a router (optional)

If a `WIFI` file is on the SD card (first line SSID, second line password), the
device joins this network as well, like before. It is then also reachable there
as `indianavi.local` or by its address in that network.

- The phone has to be able to reach the device in that WiFi. Guest networks often
  isolate clients from each other; some routers only allow traffic between
  clients on the same radio (2.4 GHz vs 5 GHz). The device uses 2.4 GHz. If
  `GET /api/info` times out, the app should tell the user to use the access point
  of the device instead.

### HTTP

- Plain HTTP/1.1 on port 80, no TLS.
- Requests that change the device (`PUT`, `DELETE`, `POST`) are accepted over the access point of the device,
  which is protected by its WPA2 password. In the WiFi of a router they need that password as token,
  `Authorization: Bearer <password of the access point>`, else the answer is `401`. Reading (`GET`) needs no
  token, except a recorded track. The app sends the token in router mode with every change; the password is
  shown with the QR code on the charging screen.
- The server has to support keep-alive. The app sends more than a thousand requests,
  so a new connection per file would be too slow.
- The app uses at most 2 connections at the same time.
- Request and response bodies are never chunked, except the download of a recorded track. Every `PUT` has a
  `Content-Length`.

## Endpoints

| Method and path | Purpose | Required |
|---|---|---|
| `GET /api/info` | find the device, check free space | yes |
| `GET /api/maps` | the vector maps on the card, read from their headers (version 2) | optional |
| `GET /sd/{dir}/` | list a folder, to skip files that are already there | yes |
| `GET /sd/TRACKS/{id}.gpx` | download a recorded track | optional |
| `PUT /sd/{path}` | write one file | yes |
| `DELETE /sd/{path}` | delete one file | optional |
| `POST /api/reload` | reload `track.gpx` and the map | optional |
| `POST /api/transfer` | announce how many files will be uploaded, shows progress on the display | recommended |
| `GET /api/transfer` | read the progress of the announced transfer | optional |
| `DELETE /api/transfer` | cancel the transfer, removes the progress from the display | optional |
| `PUT /api/firmware` | install a new firmware image | optional |
| `POST /api/restart` | restart the device, boots the installed firmware | optional |

`{path}` and `{dir}` are relative to the root of the SD card and use `/` as separator.

### GET /api/info

Tells the app that it is talking to an IndiaNavi and how much space is left.

Response `200`, `Content-Type: application/json`:

```json
{
  "id": "MeinIndiaNavi",
  "firmware": "1.2.3",
  "api": 3,
  "ota": true,
  "vector_maps": true,
  "sd": { "present": true, "free": 1234567890, "total": 7948206080 }
}
```

| Field | Meaning |
|---|---|
| `id` | `<id>` from `config.xml` |
| `firmware` | firmware version, free text |
| `api` | version of this API, `3` for this document |
| `ota` | `true` if the device accepts `PUT /api/firmware`. Missing on older firmware |
| `vector_maps` | `true` if the firmware draws vector maps, then it accepts `MAPS/{name}.map` and `GET /api/maps`. Missing before version 2 |
| `sd.present` | `false` if no SD card is mounted; `free` and `total` are `0` then |
| `sd.free`, `sd.total` | bytes |

### GET /api/maps (version 2)

The vector maps in `MAPS`, read from their headers. Takes about 30 ms per map.

Response `200`, `Content-Type: application/json`:

```json
{
  "maps": [
    { "file": "rheinl01.map", "size": 301234567, "created": 1759550000000,
      "bounds": [48.96, 6.11, 50.95, 8.51], "used": true }
  ],
  "partial": [
    { "file": "saarla01.map", "size": 10485760, "total": 20971520, "created": 1759550000000 }
  ]
}
```

| Field | Meaning |
|---|---|
| `file` | name on the card, lower case |
| `size` | bytes |
| `created` | creation date of the map in milliseconds since 1970, from its header |
| `bounds` | `[min_lat, min_lon, max_lat, max_lon]` |
| `used` | `false` if a newer map covers at least 90 % of it, then it is not drawn |
| `partial` | version 3: maps whose upload was not finished (`{name}.tmp` on the card) |
| `partial[].size` | bytes of it on the card |
| `partial[].total`, `partial[].created` | size and creation date of the map from the start of its header, `0` while not all 44 bytes of it are on the card. The app continues only the same map |

Files that are no Mapsforge map are not listed. `404` if the firmware has no vector maps, `503` if the card can
not be read.

### GET /sd/{dir}/

Lists the files of one folder. The path ends with `/`. Subfolders are not followed.

Example: `GET /sd/MAPS/16/34169/`

Response `200`, `Content-Type: application/json`:

```json
[
  { "name": "22454.raw", "size": 32768 },
  { "name": "22455.raw", "size": 32768 }
]
```

- Folders in the listing have `"dir": true` and no `size`.
- The order does not matter.
- `.tmp` files of unfinished uploads are not listed.
- `404` if the folder does not exist. The app treats that as an empty folder.

### PUT /sd/{path}

Writes one file. The body is the content of the file as raw bytes.

Example:

```
PUT /sd/MAPS/16/34169/22454.raw HTTP/1.1
Host: indianavi.local
Content-Type: application/octet-stream
Content-Length: 32768

<32768 bytes>
```

Response `204` without body once the file is completely on the card.

Rules:

1. **Allowed paths.** Only `track.gpx`, `MAPS/{zoom}/{x}/{y}.raw` with
   decimal numbers and (version 2) `MAPS/{name}.map` are accepted. Everything
   else, including any path with `..`, is answered with `400`.
2. **Folders.** Missing parent folders are created.
3. **Atomic write.** The data is written to a temporary file in the same folder
   with the extension `.tmp` (for example `22454.tmp`). If the number of bytes
   received equals `Content-Length`, the temporary file is renamed to the final
   name. Otherwise it is deleted. A broken connection must never leave a half
   written tile under its final name.
4. **Overwrite.** An existing file is replaced.
5. **Answer after the write.** The `204` is sent after the file is closed and
   renamed, not when the body was received.
6. **Continue a map (version 3).** A map can be sent with
   `Content-Range: bytes {start}-{end}/{total}` (`end` included). With `start` 0
   the `.tmp` file is created, a higher `start` continues it and has to be its
   size, else the answer is `416` with the size on the card in the text. The
   body has `end - start + 1` bytes, the file is renamed when it has `total`
   bytes. When the connection breaks, the `.tmp` file keeps the bytes that
   came in (without `Content-Range` it is deleted as before), `GET /api/maps`
   lists it under `partial`. `Content-Range` is only accepted for maps, `400`
   otherwise. `DELETE /sd/MAPS/{name}.map` also deletes the `.tmp` file.
7. **Big files.** A map is one request of many minutes. The device keeps its
   WiFi and an announced transfer running while bytes come in. The card needs
   the size of the file free, also when it replaces a map of the same name.
   Files are at most 4 GB - 1 (FAT32, and `Content-Length` is 32 bit on the
   device). The app streams maps from the file, they do not fit into memory.
   After a map was written or deleted, `POST /api/reload` makes the map screen
   read the maps again.

### GET /sd/TRACKS/{id}.gpx (optional)

Downloads a recorded track, `{id}` is the id of the recording as 8 hex digits, for example
`/sd/TRACKS/6704a1b0.gpx`. Recordings are started, stopped, listed and deleted over Bluetooth, see the track
recording in `ble_api.md`. `GET /sd/TRACKS/` lists them as well.

Response `200`, `Content-Type: application/gpx+xml`, the body is chunked (the device reads the file while it sends
it).

| Status | Meaning |
|---|---|
| `401` | the request did not come in over the access point and has no `Authorization: Bearer <password of the access point>`. A track tells where somebody was |
| `404` | no such recording |
| `409` | the track is still recorded, stop the recording first |


Deletes one file. The same paths as for `PUT` are allowed.

Response `204`, or `404` if the file does not exist.

### POST /api/reload (optional)

Asks the device to read `track.gpx` again and to redraw the map. No request body.

Response `204`.

If the device shows the map, the map is rebuilt with the new track. If the
device is switched off (charging with the off screen), nothing happens; the new
track is loaded when the user switches the device on.

### POST /api/transfer (recommended)

Tells the device how many files the app is going to upload. The device then
shows the progress on its display. Without this call the uploads work the same,
but the device does not know how many files are still to come and shows nothing.

Request, `Content-Type: application/json`:

```json
{ "files": 1523, "bytes": 49905664 }
```

| Field | Meaning |
|---|---|
| `files` | number of `PUT` requests that will follow, including `track.gpx`. Required, greater than 0 |
| `bytes` | sum of all file sizes. Optional; if it is given, the display shows the MB and the bar follows the bytes, a map is one file of hundreds of MB |

Response `200` with the same body as `GET /api/transfer`. `400` if `files` is
missing or 0.

Rules:

1. Only files the app still sends count. Tiles that are skipped because they are
   already on the card (step 2 below) must not be included in `files`.
2. Every successful `PUT` (answered with `204`) counts as one file. Failed and
   retried requests count once, when they succeed. `DELETE` does not count.
   Bytes count while they come in, the bytes of a failed `PUT` are taken back.
3. When `files` uploads have succeeded, the transfer is `done` and the display
   shows "Upload complete".
4. If no `PUT` succeeds and no bytes come in for 2 minutes, the transfer is
   `aborted` and the display shows "Upload stopped". Send `POST /api/transfer`
   again to start a new one.
5. A new `POST /api/transfer` replaces the previous one and starts counting at 0.
6. When WiFi goes away (charger unplugged), the transfer is forgotten.

The display is an e-ink display that needs about 16 seconds for a refresh.
It is redrawn when the transfer starts, at every 10 % step (at most every 20
seconds) and when it is done or stopped. It does not show every single file.

### GET /api/transfer (optional)

Response `200`, `Content-Type: application/json`:

```json
{ "state": "active", "files": 1523, "files_done": 412, "bytes": 49905664, "bytes_done": 13500416 }
```

| Field | Meaning |
|---|---|
| `state` | `idle` (nothing announced), `active`, `done` or `aborted` |
| `files`, `bytes` | as announced |
| `files_done`, `bytes_done` | stored so far |

### DELETE /api/transfer (optional)

Cancels the transfer and removes the progress from the display, for example when
the user cancels in the app. Files already stored stay on the card.

Response `204`.

### PUT /api/firmware (optional)

Installs a firmware. The body is the application image (`firmware.bin`, the
build output of the firmware project) as raw bytes with a `Content-Length`.

The device writes it to the inactive OTA partition and checks the image. The
running firmware is not touched, so a broken or interrupted upload changes
nothing. Response `204` once the image is stored and selected for the next boot.

| Status | When |
|---|---|
| `400` | the image is not valid |
| `411` | no `Content-Length` |
| `500` | no update partition, or the write failed |
| `507` | the image is bigger than the update partition |

Writing takes up to a minute. The app sends the request with a long timeout.

### POST /api/restart (optional)

Restarts the device after the answer was sent. Response `204`. After
`PUT /api/firmware` the device boots the new firmware. The WiFi is gone for a
short time, the app has to connect again.

## Errors

Errors have a short plain text body with the reason, for the log of the app.

| Status | When |
|---|---|
| `400` | path not allowed or malformed, `Content-Range` that does not fit |
| `401` | a change (`PUT`, `DELETE`, `POST`) in the WiFi of a router without the token, see "HTTP" |
| `404` | file or folder does not exist (`GET`, `DELETE`) |
| `411` | `PUT` without `Content-Length` |
| `416` | `Content-Range` does not start where the part of the map on the card ends |
| `500` | write, rename or delete failed |
| `503` | no SD card, or the card is busy |
| `507` | not enough space on the card |

The app retries `500` and `503` a few times and stops the transfer on `507`.

## How the app uses the API

1. `GET /api/info`. Stop if `sd.present` is false or `sd.free` is smaller than the transfer.
2. `GET /sd/MAPS/{zoom}/{x}/` for every `{x}` folder of the track, about 50 requests.
   Tiles that are listed with 32768 bytes are skipped.
3. `POST /api/transfer` with the number of missing tiles plus 1 for `track.gpx`.
4. `PUT` all missing tiles, on 2 connections.
5. `PUT /sd/track.gpx` as the last file. An interrupted transfer then never
   leaves a new track without its map.
6. `POST /api/reload`.

If the user cancels, send `DELETE /api/transfer`.

A transfer takes time: the device stores about 5 tiles per second (measured with
2 connections, about 180 kB/s), so 1500 tiles take about 5 minutes.

Vector maps (version 2, `vector_maps` in `GET /api/info`):

1. `GET /api/maps` to see which maps are on the card.
2. For a map that is missing or has another size: check `sd.free` of `GET /api/info`,
   `POST /api/transfer` with `{"files": 1, "bytes": <size>}`, `PUT /sd/MAPS/{name}.map`
   streamed from the file, `POST /api/reload`. From version 3 with
   `Content-Range: bytes 0-{size - 1}/{size}`, and when `partial` has the same map
   (same `total` and `created`) only the rest: `bytes {partial size}-{size - 1}/{size}`,
   announced with the bytes of the rest. The device seeks to the end of the part
   once, the rest is one request. On `416` the app reads `partial` again.
3. `DELETE /sd/MAPS/{name}.map` and `POST /api/reload` removes a map.

The speed of a single big upload is not measured yet; at the 180 kB/s of the tiles a map of 300 MB takes about
half an hour. The app measures the speed of every map it sends (at least 10 seconds) and estimates the next ones
from it.

## Testing without the app

```sh
curl http://indianavi.local/api/info
curl http://indianavi.local/sd/MAPS/16/34169/
curl -T 22454.raw http://indianavi.local/sd/MAPS/16/34169/22454.raw
curl -T track.gpx http://indianavi.local/sd/track.gpx
curl -X DELETE http://indianavi.local/sd/MAPS/16/34169/22454.raw
curl http://indianavi.local/api/maps
curl -T germany-saarland.map http://indianavi.local/sd/MAPS/saarla01.map
# the rest of a map from byte 10485760 of 20971520
tail -c +10485761 germany-saarland.map > rest && curl -T rest -H 'Content-Range: bytes 10485760-20971519/20971520' http://indianavi.local/sd/MAPS/saarla01.map
curl -X POST http://indianavi.local/api/reload
curl -X POST -d '{"files": 2, "bytes": 65536}' http://indianavi.local/api/transfer
curl http://indianavi.local/api/transfer
curl -X DELETE http://indianavi.local/api/transfer
```

## Notes on the current firmware

- Folder listings return all names in lower case, folders too (`maps`). The card
  stores upper case 8.3 names only (`CONFIG_FATFS_LFN_NONE=y`). Paths in requests
  are not case sensitive, so `MAPS/...` and `maps/...` are the same.
- `CONFIG_LWIP_MAX_SOCKETS=10`: the server accepts 3 connections at the same
  time. The app should stay at 2.
- A connection is closed after 10 seconds without data.
- The map loader of the firmware also writes to `MAPS/...` when it downloads
  tiles itself. It is not started today.

## Open points

- **WiFi availability.** The server runs only while charging, because WiFi is only
  on then. The device stays awake and connected while it is charging.
- **Access control.** In the access point of the device only who knows the
  password (shown on the device) can connect. In a router WiFi changes need the
  same password as token, but it goes over plain HTTP: anyone who can read the
  traffic of that WiFi learns it.
