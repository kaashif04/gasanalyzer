# How to recalibrate the biogas analyzer

Print this page or keep it with the unit. No technical knowledge needed.

## When to do this

Whenever the unit is turned on in a **new room, or after being moved**, even
if it's a room it's been in before. Takes 30 minutes. Do this **before**
introducing any biogas — it must run in clean (normal room) air.

## Steps

1. Place the unit where it will actually be used. Make sure no gas is being
   introduced yet — clean air only.
2. Power it on (or press the **RESET** button if it's already on).
3. Within the first few seconds, the screen will show:
   ```
   Hold BOOT 2s now
   = CALIBRATE mode
   ```
   You have about **6 seconds** to react. Press and **hold** the button
   labeled **BOOT** (a small button on the board itself, not the LCD) for a
   full **2 seconds**. Don't let go early.
4. If it worked, the screen changes to:
   ```
   ** CALIBRATE **
   Clean air only!
   ```
   then a few seconds later:
   ```
   CALIBRATING...
   Left 29:45 n=12
   ```
   The `Left MM:SS` counts down from 30:00 to 0:00. **This is how you know
   it's working** — leave it alone and don't introduce any gas while this is
   counting down.
5. If you missed the window, nothing bad happens — it just continues into
   normal logging instead. Press RESET and try again from step 2.
6. When the countdown finishes, the screen shows:
   ```
   CALIBRATE DONE
   Resuming normal
   ```
   for a few seconds, then it goes back to normal logging on its own. You're
   done — no further action needed.

## What if something goes wrong

- **"CALIBRATE FAILED / Too few samples"** — the humidity/temperature sensor
  couldn't get enough good readings during the 30 minutes. Try again; check
  nothing is blocking the small sensor on the side of the unit.
- **"CALIBRATE: SD / write FAILED"** — the SD card couldn't be written to.
  Check the SD card is inserted properly. The previous calibration is kept
  unchanged either way — nothing is lost if this happens.

## Why this matters

The unit corrects its gas readings for the current temperature and humidity.
That correction is only accurate for the room conditions it was last
calibrated in. Moving it to IWK (or anywhere new) means the old correction
may be off — running this 20-minute calibration teaches it the new room's
normal conditions, so its gas readings stay trustworthy.

The dashboard will also show an on-screen warning ("Outside calibrated
compensation range") any time live conditions drift outside whatever was
last calibrated — so if you forget this step, it'll be visible there too,
not just here.
