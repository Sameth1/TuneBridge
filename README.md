# TuneBridge

**Share a song once. Let friends open it in the music app they use.**

TuneBridge turns a track URL from Apple Music, Spotify, YouTube Music, Deezer, or SoundCloud into one shareable page. The recipient chooses a service. When TuneBridge can identify the same recording with sufficient confidence, the button points to the **track itself**; otherwise it is clearly labeled as a search link. The interface is in English by default, with a Turkish option in the header; the choice is remembered in the browser.

> **Status:** Working web app deployed on Vercel, plus Android and iOS apps in `mobile/` (Capacitor). The Android app builds here; the iOS app and its Share Extension need a Mac with Xcode and have not been device-tested yet.

## Why it exists

A Spotify recipient should not have to transcribe an Apple Music song title and search for it manually. This is especially awkward for songs written in a different alphabet. TuneBridge reads publicly available track metadata, compares catalog candidates, and creates one page with links for the recipient's preferred platform. A Spotify or Apple Music subscription is **not needed to resolve an incoming link**. Listening access and playback behavior are still controlled by the destination platform.

## Features

- Accepts **track and album links** from Apple Music, Spotify, YouTube / YouTube Music (including `youtu.be` and `OLAK5uy_` album playlists), Deezer, and SoundCloud (sets), plus app short links (`on.soundcloud.com`, `spotify.link`, `link.deezer.com`).
- Resolves track title, artist, cover art, album, duration, and ISRC when the sources provide them.
- Shows direct track links only for matches supported by recording relationships or strict metadata comparison.
- Falls back to a clearly marked platform search when a direct match is uncertain or unavailable.
- Generates `/s?url=...` pages with Open Graph song metadata for sharing in messaging and social apps.
- Includes browser copy/share actions, an installable web app with a Share target, and Android and iOS apps that appear in the phone's Share menu.
- Requires no database or account for the MVP.

### Platform coverage

| Platform | Accepted as input | Direct destination link when verified |
| --- | --- | --- |
| Apple Music | Yes | Odesli, MusicBrainz relationship, Apple Music API ISRC lookup (optional), or Apple catalog match |
| Spotify | Yes | Odesli, MusicBrainz relationship, or optional Spotify API lookup (ISRC first) |
| YouTube Music | Yes | Odesli, MusicBrainz relationship, YouTube Music "Songs" search, or the song's auto-generated Topic upload |
| YouTube | Yes | Odesli, MusicBrainz relationship, the artist's official (verified-channel) music video, or the Topic upload |
| Deezer | Yes | Odesli, Deezer ISRC lookup, Deezer catalog match, or MusicBrainz relationship |
| SoundCloud | Yes | Odesli, SoundCloud search match (ISRC preferred), or MusicBrainz relationship |

Catalog coverage varies by track and country. A search button is a deliberate result, not a claim that an exact match was found.

## How matching works

1. **Parse and validate the input.** `lib.js` accepts known music domains and track URL formats; short share links are expanded by following their redirects. User playlists are outside this MVP's scope; albums are resolved as described under *Albums* below.
2. **Fetch source metadata.** Apple and Deezer provide catalog metadata. Spotify uses its Web API when credentials are configured, otherwise the public embed page (title, artists, duration). YouTube uses the watch page: auto-generated "Topic" uploads carry title, artist and album in their description; for music videos, "Artist - Title" is split and the video length is treated as unreliable. SoundCloud uses the track page data, including the label-supplied artist and ISRC when present. oEmbed is the fallback everywhere.
3. **Collect verified cross-platform links.** MusicBrainz is consulted for Spotify inputs, [ListenBrainz Labs](https://labs.api.listenbrainz.org/) suggests Spotify and Apple Music ids by artist and title (no key needed; each id is read back from the platform and checked like any other candidate), and [Odesli](https://odesli.co) (song.link) for every input when `ODESLI_API_KEY` is set. Every Odesli result must agree with the source on title/version and artist before it is used.
4. **Recover missing metadata from artwork.** If the source still has only a title and cover, TuneBridge compares the cover with Apple catalog candidates for that title and accepts a nearly identical, unambiguous candidate.
5. **Search the remaining catalogs.** Apple (iTunes Search, then title-only search, then Apple Music's own search page with each song's length read from its page, which iTunes' ~20 requests/minute limit does not reach, then ListenBrainz ids), Deezer (by ISRC, then plain search, then the title alone), YouTube Music (songs only, falling back to official YouTube uploads), SoundCloud (tracks with an ISRC, UPC or paid streaming, or the artist's own account) and Spotify (Web API with credentials; otherwise ListenBrainz ids, then each credited artist's top tracks and the album's track list from Spotify's embed pages, found through the Spotify ids MusicBrainz links to the artist and the release) are searched. A versioned name ("Belki (Akustik)") is searched with its version words. The same recording under a transliterated name ("Tamally Maak" / "Tamly Maak") counts as exact when only vowels or doubled letters differ and the length agrees within 2 s. Official YouTube uploads are Topic uploads, the artist's own verified channel (up to 90 s longer than the track for a music video), and verified label channels (plain "Artist - Title" uploads within 20 s). A remaster label does not block a match: it is the same performance. A candidate must agree on track title/version and artist, plus a close duration (≤ 6 s) or matching ISRC. Live, remix, acoustic, cover and other version labels are checked to reduce false matches. When the ISRC is known, Deezer and Spotify are looked up by ISRC directly. For a music-video source, a title and artist match is accepted only when every such catalog result is the same recording.
6. **Fall back to the closest match.** Names often differ between platforms ("Nour El Ein | Official Music Video - HD Version | عمرو دياب - نور العين" on YouTube, "Nour El Ain" elsewhere). Every source title is broken into plain name variants (label words such as *Official Video*, *HD*, *Lyrics* dropped, "Artist - Title" and "a | b" parts separated), YouTube videos are read through YouTube Music's own song data, and every variant is searched. When no candidate passes the exact rules, candidates are scored on name similarity (spelling-tolerant), artist, duration and cover art; the best one scoring ≥ 0.78 is returned as a **closest match** that names the song it found. Different versions (live, remix, acoustic…) never qualify.
6a. **Identify uploads and performances.** A YouTube video uploaded by someone other than the artist ("EZHEL-Başa Bela(sözleri lyrics)" on a lyrics channel) does not name the artist in its channel. Its title is cleaned (hashtags, *Official Audio*, *sözleri*, *Prod.* credits dropped) and searched on Deezer, then with fewer and fewer words, until a release appears whose artist and name the title contains (`identify.js`). That release, with its ISRC, is what the other platforms are matched against. If the upload is another version of it (remix, live, sped up, bass boosted, a loop, or more than 15 s shorter or longer), every other platform shows the original as the closest match and the page names the upload's version ("Başa Bela (Vedat Unal Remix)"). The uploader's channel name never goes into a search. An artist's own video that no catalog recognises by its name (a TV or stage performance, "'Dynamite' @ America's Got Talent") is identified the same way: "@ <show>" marks a live take, quoted names are searched first, and another live recording of the song is only the closest match unless it names the same show.
7. **Label the result.** Verified URLs are shown as **“Open the song”**, closest matches as **“Closest match: <title — artist>”**, and platforms with nothing close enough as **“Search on platform”**. The API reports this per platform as `match: "exact" | "close" | "search"`.

This is a conservative matching system, not an audio fingerprinting service. Catalog records can be incomplete, and two releases can share metadata or artwork. The app does not stream music or start playback through a service API; opening a direct link hands control to that platform. YouTube Music has no separate song page, so its direct link is a watch URL, and the YouTube Music app may start playing it on open.

YouTube Music search, YouTube's player and search endpoints and SoundCloud search are unofficial public web endpoints; if they change, those platforms fall back to search links until the parser is updated.

### Albums

An album link is read for its title, artist, track count, year and first tracks. Deezer is matched first because its album record carries the UPC: with a UPC, Deezer and the MusicBrainz release for that barcode give exact album links (Spotify, Apple, YouTube album playlists). The remaining platforms are searched and must agree on title, edition (Deluxe, Remastered, Live… are different releases), artist and track count. Without Spotify credentials, the album is found through one of its tracks: the track's Spotify page names its album, which is then checked. YouTube Music albums are found the same way through a track's YouTube Music page.

## Sharing from a phone

Nobody needs an account, and the recipient needs nothing installed.

- **Android (Chrome, Edge, Samsung Internet):** the site is an installable web app. After *Add to home screen* (the button in the header, or the browser menu), **TuneBridge appears in the phone's Share menu**. Sharing a song from Spotify, Apple Music, YouTube or any other app opens `/share`, which finds the link in the shared text, drops tracking parameters (`si`, `utm_*` …) and shows the TuneBridge page to send on.
- **iPhone:** Safari does not let web apps join the Share menu. Two options: a Shortcuts shortcut with *Show in Share Sheet* on that opens `https://<your-domain>/share?url=` + *Shortcut Input* (no App Store needed), or the native Share Extension in `mobile/ios/ShareExtension` (needs an Apple Developer account to distribute).
- **A plain Spotify/Apple/YouTube link received in WhatsApp or similar:** tapping it always opens that platform — the phone decides, and no website or app can take over another service's links. Instead, long-press the link and share it to TuneBridge (Android, or the iPhone shortcut), or copy it and use **Paste a copied link** on the home page. The recipient's remembered app is listed first and highlighted.
- **Search history (opt-in):** *Save my searches on this device* keeps the last 12 lookups in that browser only; turning it off deletes them. *Search new song* clears the link field for the next paste.
- **Recipient:** opens the shared link in any browser and taps their app. With *Open links in the app I pick next time* ticked, later TuneBridge links open straight in that app after a short “Opening in Spotify…” notice with a *Choose another app* button. The choice is kept only in that browser.

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

Run the focused tests with `npm test`; they mock every network request. There is no build step for the web app: `server.js` serves `public/` and provides the resolution API.

## Configuration

All variables are server-side environment variables. Never put Spotify credentials in `public/` or commit them.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `PUBLIC_BASE_URL` | For public hosting | HTTPS origin used in Open Graph canonical URLs. |
| `MUSICBRAINZ_CONTACT` | Recommended for public hosting | Reachable contact URL or email in the MusicBrainz user agent. |
| `SPOTIFY_CLIENT_ID` | No | Enables Spotify Web API track lookup and search when paired with the secret. |
| `SPOTIFY_CLIENT_SECRET` | No | Server-only Spotify client secret. |
| `ODESLI_API_KEY` | No | Odesli API key. Odesli's keyless public API has been retired, so Odesli is skipped without a key. |
| `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` | No | Apple Music API (MusicKit key from a paid Apple Developer Program membership). Enables exact ISRC lookups and avoids the iTunes Search API's ~20 requests/minute limit. The private key is the `.p8` file contents; `\n` escapes are accepted. |
| `SOUNDCLOUD_CLIENT_ID` | No | Fixed SoundCloud api-v2 client ID; otherwise it is read from SoundCloud's web player. |

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
| `GET /share?url=…` or `?text=…` | Web Share Target entry of the installed app; forwards to `/s`. |
| `GET /s?url=<encoded-track-url>` | Share page. Server injects Open Graph title, artist, artwork, and canonical URL when metadata resolves. |
| `GET /api/check?url=<encoded-track-url>` | Validates a supported track URL. |
| `GET /api/resolve?url=<encoded-track-url>&country=tr` | Returns song metadata and destination links. `country` is a two-letter catalog code; default is `us`. |

Each item in `platforms` contains `id`, `name`, `url`, and `exact`. **`exact: true` means a direct track URL was selected**, while `false` means the URL opens a search page. The browser UI uses the visitor's language region when available.

## Deploying on Vercel

`vercel.json` serves `public/` as static files and routes `/api/*`, `/s` and `/share` to one Node function (`api/index.js`, which reuses the handler in `server.js`). No build step is needed. Set `PUBLIC_BASE_URL` to the production origin and `MUSICBRAINZ_CONTACT` in the project's environment variables; the optional keys from *Configuration* go there too.

## Public deployment and sharing

To send a TuneBridge URL to another person, deploy the Node server on a publicly reachable **HTTPS** origin, set `PUBLIC_BASE_URL` to that origin, and use that address for generated `/s` links. A GitHub repository by itself does not host this server. The app makes outbound requests to music catalogs, MusicBrainz, and image CDNs, so the host needs network access. Protect a public instance with appropriate request limits and monitoring before promoting it widely.

The in-memory resolution cache lasts up to one hour; artistless results expire after 15 seconds so a temporary upstream failure can recover quickly. It is cleared when the process restarts.

## Android and iOS apps

`mobile/` wraps the same page in native apps so TuneBridge appears in the phone's Share menu without an account: an Android share intent, an iOS Share Extension, and a `tunebridge://share?url=…` scheme for iPhone Shortcuts. Building, signing and the store checklist are in [`mobile/README.md`](mobile/README.md). The privacy policy the stores ask for is `public/privacy.html`.

## Repository structure

```text
public/             Browser UI
server.js           HTTP server, API routes, sharing metadata, cache
resolve.js          Platform metadata and candidate matching pipeline
musicbrainz.js      MusicBrainz lookups and recording relationships
artwork.js          Album cover comparison
lib.js              URL parsing, normalization, matching, search URLs
mobile/             Android and iOS apps (Capacitor) and the iOS Share Extension
api/                Vercel function entry
*.test.js           Node test runner tests
```

## Current limitations

- User playlists are not accepted.
- YouTube and YouTube Music album pages are found only through MusicBrainz, a YouTube album input, or YouTube Music's own search; from some server IPs YouTube Music search returns no songs or albums, and then those two platforms fall back to search links for albums.
- SoundCloud only links to label-distributed tracks or the artist's own account, so re-uploads show a search link instead.
- Spotify oEmbed does not supply all track fields. When MusicBrainz and artwork matching both fail, artist and direct destinations may remain unknown.
- ISRC identifies a recording, but catalogs may expose multiple releases or regional versions; a direct link does not guarantee playback without the destination service's normal access.
- No persistent database, public abuse controls, user accounts, analytics, or automatic playback are included.

## Data sources and references

- [Spotify oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed) and [Web API access modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) and [rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Apple iTunes Search API result fields](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html)
- [Deezer API](https://developers.deezer.com/api)
- [ListenBrainz Labs API](https://labs.api.listenbrainz.org/)

TuneBridge is an independent project and is not affiliated with the music platforms above.

## Localization

The web UI is English by default with a Turkish switch; strings live in `public/i18n.js`. The apps show the same page, so they share those strings. The iOS Share Extension's own few strings are in `mobile/ios/ShareExtension/en.lproj` (development language) and `tr.lproj`, and both apps declare English and Turkish.

## Credits

Platform icons are from [Simple Icons](https://simpleicons.org) (CC0). The brand marks themselves belong to their owners and are used only to label links to their services.
