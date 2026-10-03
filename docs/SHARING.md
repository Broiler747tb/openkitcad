# Sharing models

Click **Share**, then **Copy link**. The link contains a snapshot of the whole design. Later edits stay in your project and don't change that snapshot.

The recipient gets a view-only 3D page. They can orbit, zoom, download the original `.okc`, or choose **Open a copy**. Opening a copy asks before replacing an existing project and keeps the previous autosave aside. Viewing alone writes neither the design, imported meshes, nor custom parts into their storage.

There is no model server, upload, account, or tracking call. The app and its geometry engine still load from the existing static site. Model data lives after `#` in the URL, so it isn't sent in that HTTP request. Anyone who receives the complete link has the model; there is no access revocation.

Links made in the Portable EXE point to the public browser app. Clipboard access has a manual selection fallback.

## What fits

Parametric models travel as their construction steps, dimensions, placements, and references. Built-in parts come from the catalogue. Referenced custom parts and imported meshes are included, so another computer doesn't need your local library.

An 8,000-character cap keeps oversized links out of the clipboard. This is a practical limit, not a guarantee that every messenger accepts that length. If a link is cut off or the model is too large, send the `.okc` file instead. The printer example contains substantial imported mesh data and needs a file.

Coordinates retain their full precision. There is no geometry reduction or rounding for sharing.

## Link format 1

New links use `#m=1.<payload>`. Existing `#d=...` editable links still work; adding `&view=1` to a small legacy link opens the viewer.

The payload is unpadded Base64url containing a raw DEFLATE stream. Its expanded bytes are a mode byte, document data, and a four-byte little-endian FNV-1a checksum over the mode and data. Mode 0 carries UTF-8 JSON; mode 1 carries the compact binary document. The encoder tries both and uses the smaller compressed result.

The compact representation uses unsigned base-128 integers, signed integers encoded as `-1-n`, and little-endian IEEE-754 doubles. IDs are stored once in a table and referenced by index, preserving their original values. Common keys and string values have fixed numeric codes. Operation schemas store a presence mask followed by their present fields in schema order. Matching root defaults are omitted with a mask and restored on decode. Unknown fields use the generic object representation and survive unchanged.

The tables and schemas in `src/doc/shareCodec.ts` are part of format 1. Do not reorder or edit existing entries. A changed interpretation needs a new format version and an old-version decoder. New CAD fields already fall back to generic encoding, so they don't require a format change.

Readers check the checksum, reject truncated binary records, unknown versions and invalid document structure, and bound expanded data to 8 MiB and binary nesting to 96 levels. The checksum detects accidental damage; it is not a signature. `.okc` files keep their existing JSON format.

Run `node scripts/share-codec-test.mjs` for exact round trips, malformed input, and generated data. `npm test` also exercises real browser links, mesh and custom-part downloads, clipboard fallback, mobile layout, and accepting or declining a copy over existing work.
