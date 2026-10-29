# Test access without an IndiaNavi

The app contains an IndiaNavi that exists only on the phone. It shows the screens of a connected device
(device information, SD card space, sending files, firmware update) without hardware and without any WiFi,
for example for automated tests.

## Credentials

Open the file transfer, choose **WiFi of the IndiaNavi** and type in:

| Field | Value |
|---|---|
| WiFi name | `IndiaNavi-7A21` |
| Password | `wanderweg42` |

Then tap **Connect**. The app does not join a WiFi, so the camera and the location permission are not needed.

## What is shown

After Connect the screen shows the green message
`Connected to IndiaNavi-7A21 (firmware 1.2.3). SD card: 6144.0 MB free of 8192.0 MB.`
with the **Files** and **Firmware** sections below it.

- With prepared files (choose a track, tap Prepare SD card files on the main screen), **Send to IndiaNavi** shows the
  progress and finishes with `Done. N files (…) sent, 0 tiles were already on the IndiaNavi.`
- **Update all tiles on the IndiaNavi** works the same way for the tiles stored on the phone.
- **Update firmware** accepts a firmware file and ends with the message that the IndiaNavi restarts.
- **Vector maps** lists the maps checked on the Maps screen and the maps on the simulated SD card. **Send** stores
  a map on the simulated card (only its size, date and area, nothing is copied) and shows its progress, **Delete**
  removes it. A newer map of the same region shows the older one as replaced. The simulated card keeps the maps
  while the app runs. Cancelling a map that is sent keeps its part on the simulated card like the device does, the map then
  shows **Continue**, which sends the rest.

Nothing is sent over the network, the files are not copied anywhere.

## Code

`modules/simulated_device.js` holds the credentials and the answers of the device. `modules/device_transfer.js`
answers the requests for `SIMULATED_BASE` from there instead of sending them. Any other name or password connects to
a real IndiaNavi as before.
