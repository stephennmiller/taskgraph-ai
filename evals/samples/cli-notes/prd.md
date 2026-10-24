# Notes CLI

A command-line tool for keeping short notes in a local file.

## Goal

Developers want to jot a note from the terminal without opening an editor, and find it again later.

## Commands

- `notes add "<text>"` saves a note with the current time.
- `notes list` prints the 20 most recent notes, newest first.
- `notes search <word>` prints every note containing the word, ignoring case.
- `notes rm <id>` deletes a note by its number.

## Storage

Notes live in `~/.notes.json`. The file is created on first use. A write never leaves a half-written file.

## Out of scope

Sync, tags, editing a note, and colors.
