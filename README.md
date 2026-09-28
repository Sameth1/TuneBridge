# TuneBridge

**Share a song once. Let friends open it in the music app they use.**

TuneBridge turns a track URL from Apple Music, Spotify, YouTube Music, Deezer, or SoundCloud into one shareable page. The recipient chooses a service. When TuneBridge can identify the same recording with sufficient confidence, the button points to the **track itself**; otherwise it is clearly labeled as a search link. The interface is currently in Turkish.

> **Status:** Working web MVP and an iOS Share Extension source scaffold. The iOS project has not been built or tested on a device. This repository does not include a hosted deployment; `localhost` share links work only on the computer running the server.

## Why it exists

A Spotify recipient should not have to transcribe an Apple Music song title and search for it manually. This is especially awkward for songs written in a different alphabet. TuneBridge reads publicly available track metadata, compares catalog candidates, and creates one page with links for the recipient's preferred platform. A Spotify or Apple Music subscription is **not needed to resolve an incoming link**. Listening access and playback behavior are still controlled by the destination platform.

## Features

- Accepts **individual track links** from Apple Music, Spotify, YouTube Music, Deezer, and SoundCloud.
- Resolves track title, artist, cover art, album, duration, and ISRC when the sources provide them.
- Shows direct track links only for matches supported by recording relationships or strict metadata comparison.
- Falls back to a clearly marked platform search when a direct match is uncertain or unavailable.
- Generates `/s?url=...` pages with Open Graph song metadata for sharing in messaging and social apps.
- Includes browser copy/share actions and iOS app plus Share Extension source files.
- Requires no database or account for the MVP.

### Platform coverage

| Platform | Accepted as input | Direct destination link when verified |
| --- | --- | --- |
| Apple Music | Yes | MusicBrainz relationship or Apple catalog match |
| Spotify | Yes | Original Spotify URL, MusicBrainz relationship, or optional Spotify API lookup |
| YouTube Music | Yes | Original YouTube Music URL or MusicBrainz recording relationship |
| Deezer | Yes | Deezer catalog match or MusicBrainz relationship |
| SoundCloud | Yes | Original SoundCloud URL or MusicBrainz recording relationship |

Catalog coverage varies by track and country. A search button is a deliberate result, not a claim that an exact match was found.

## How matching works

1. **Parse and validate the input.** `lib.js` accepts known music domains and track URL formats. Album and playlist links are outside this MVP's scope.
2. **Fetch source metadata.** Apple and Deezer provide catalog metadata; Spotify uses its official oEmbed endpoint unless optional Spotify API credentials are configured. YouTube and SoundCloud use oEmbed. Some oEmbed responses lack artist or duration.
3. **Consult MusicBrainz.** For a Spotify URL, TuneBridge looks for a linked MusicBrainz recording, then reads artist, duration, ISRCs, and recording URL relationships. An ISRC found later can also lead to linked destination URLs.
4. **Recover missing Spotify metadata from artwork.** If the source supplies only a title and cover, TuneBridge compares the cover with Apple catalog candidates for that title. It accepts a nearly identical, unambiguous candidate and obtains artist and duration from that result.
5. **Compare catalog candidates.** Apple and Deezer candidates must agree on track title/version and artist, plus a close duration or matching ISRC. Live, remix, acoustic, and other version labels are checked to reduce false matches. Album artwork can help choose between otherwise plausible Apple releases.
6. **Label the result.** Verified URLs are shown as **“Şarkıyı doğrudan aç”** (open track directly). Other platforms show **“Platformda ara”** (search on platform), leaving the final choice to the listener.

This is a conservative matching system, not an audio fingerprinting service. Catalog records can be incomplete, and two releases can share metadata or artwork. The app does not stream music or start playback through a service API; opening a direct link hands control to that platform.

## Quick start

Requirements: **Node.js 20+** and npm.

```bash
npm install
npm start
```

Open <http://localhost:3000>. Paste a track URL or open a share URL directly:

```text
http://localhost:3000/s?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F3V9Cf4pENsRh02WTMJ726n
```

The example is **“Divane” by Yaşar**. In the tested catalog, TuneBridge resolves direct Apple Music and Deezer track links for it. Results can change when external catalogs change.

Run the focused tests with `npm test`. There is no build step for the web app: `server.js` serves `public/` and provides the resolution API.

## Configuration

All variables are server-side environment variables. Never put Spotify credentials in `public/` or commit them.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `PUBLIC_BASE_URL` | For public hosting | HTTPS origin used in Open Graph canonical URLs. |
| `MUSICBRAINZ_CONTACT` | Recommended for public hosting | Reachable contact URL or email in the MusicBrainz user agent. |
| `SPOTIFY_CLIENT_ID` | No | Enables Spotify Web API track lookup and search when paired with the secret. |
| `SPOTIFY_CLIENT_SECRET` | No | Server-only Spotify client secret. |

For a local PowerShell session, for example:

```powershell
$env:MUSICBRAINZ_CONTACT = 'https://example.com/contact'
npm start
```

Spotify credentials improve possible direct Spotify matches but are **not required** for MusicBrainz-linked tracks. Check the current Spotify developer access rules before relying on its Web API in a public product.

## HTTP endpoints

| Endpoint | Description |
| --- | --- |
| `GET /` | Main web UI. |
| `GET /s?url=<encoded-track-url>` | Share page. Server injects Open Graph title, artist, artwork, and canonical URL when metadata resolves. |
| `GET /api/check?url=<encoded-track-url>` | Validates a supported track URL. |
| `GET /api/resolve?url=<encoded-track-url>&country=tr` | Returns song metadata and destination links. `country` is a two-letter catalog code; default is `us`. |

Each item in `platforms` contains `id`, `name`, `url`, and `exact`. **`exact: true` means a direct track URL was selected**, while `false` means the URL opens a search page. The browser UI uses the visitor's language region when available.

## Public deployment and sharing

To send a TuneBridge URL to another person, deploy the Node server on a publicly reachable **HTTPS** origin, set `PUBLIC_BASE_URL` to that origin, and use that address for generated `/s` links. A GitHub repository by itself does not host this server. The app makes outbound requests to music catalogs, MusicBrainz, and image CDNs, so the host needs network access. Protect a public instance with appropriate request limits and monitoring before promoting it widely.

The in-memory resolution cache lasts up to one hour; artistless results expire after 15 seconds so a temporary upstream failure can recover quickly. It is cleared when the process restarts.

## iOS Share Extension scaffold

`ios/project.yml` is an XcodeGen project definition for an iOS 16+ app and Share Extension. The extension accepts a shared music URL, creates the hosted `/s?url=...` URL, and copies it to the clipboard. It is intended to appear in the iOS share sheet after the app is built and installed.

To continue on a Mac:

1. Deploy the web server and replace `YOUR_DOMAIN_HERE` in `ios/project.yml` and `ios/App/TuneBridgeApp.swift` with its HTTPS domain.
2. Install Xcode and XcodeGen; run `xcodegen generate` from `ios/`.
3. Set unique bundle identifiers and your Apple development team in Xcode.
4. Build on a device, enable the TuneBridge share action, and test sharing from the supported music apps.

The iOS files were authored on Windows and **have not been compiled or device-tested**. The share action currently copies the generated link; it does not post a message on the user's behalf.

## Repository structure

```text
public/             Browser UI
server.js           HTTP server, API routes, sharing metadata, cache
resolve.js          Platform metadata and candidate matching pipeline
musicbrainz.js      MusicBrainz lookups and recording relationships
artwork.js          Album cover comparison
lib.js              URL parsing, normalization, matching, search URLs
ios/                iOS app and Share Extension scaffold
*.test.js           Node test runner tests
```

## Current limitations

- Album and playlist URLs are not accepted.
- YouTube Music and SoundCloud frequently have only a search fallback because cross-platform recording links are sparse.
- Spotify oEmbed does not supply all track fields. When MusicBrainz and artwork matching both fail, artist and direct destinations may remain unknown.
- ISRC identifies a recording, but catalogs may expose multiple releases or regional versions; a direct link does not guarantee playback without the destination service's normal access.
- No persistent database, public abuse controls, user accounts, analytics, or automatic playback are included.

## Data sources and references

- [Spotify oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed) and [Web API access modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) and [rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Apple iTunes Search API result fields](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html)
- [Deezer API](https://developers.deezer.com/api)

TuneBridge is an independent project and is not affiliated with the music platforms above.
