# SUPERSEDED — do not use this folder

**This folder no longer works and is not how the app is installed.** It is kept
only until it is deleted; nothing reads it.

- Umbrel cannot add a community store from a subfolder of another repository,
  so the install steps this README used to give (add the repo URL plus
  `/umbrel-app-store`) return a 404.
- Umbrel also requires every app id in a store to be prefixed with the store's
  id; `ajd-design-manager` under store id `ajd-apps` was not.

The app now lives in the Tenon community app store, as `tenon-ajd-design-manager`:

```
https://github.com/devcal1/tenon-umbrel-store
```

Add that URL under **App Store → ⋯ menu → Community App Stores** in umbrelOS,
then install **AJD Design Manager**. Release steps are in that repository's
README. See also the Packaging section of this repository's `CLAUDE.md`.
