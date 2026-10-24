# Habit Tracker App

## Summary

A mobile app that helps people build daily habits with streaks and gentle reminders. It works fully offline and syncs when a connection is available.

## Users

Individuals who want to build two to five habits, such as reading or stretching. They open the app once or twice a day, usually for under a minute.

## Features

### Habits

- Create a habit with a name, an emoji, and a schedule: every day, or chosen weekdays.
- Edit or archive a habit. Archived habits keep their history.
- Reorder habits by dragging.

### Check-ins

- Mark a habit done for today with one tap; tap again to undo.
- Mark a missed day done up to two days late.
- Today's screen shows only the habits scheduled for today.

### Streaks and history

- Show the current streak and the longest streak for each habit. A day the habit isn't scheduled doesn't break a streak.
- A calendar view per habit shows done and missed days for the last 12 months.

### Reminders

- Each habit can have one local notification at a chosen time.
- No reminder fires if the habit is already done that day.

### Accounts and sync

- The app works without an account.
- Signing in with Apple or Google backs up habits and check-ins and syncs them between devices.
- Edits made offline on two devices merge: a check-in on either device counts.

## Platforms and Stack

React Native with Expo for iOS and Android. Local data in SQLite. Sync through a small backend the team will build with Supabase.

## Success Metrics

- 40% of new users still check in on day 30.
- Crash-free sessions above 99.5%.

## Out of Scope

Social features, sharing streaks, and a web version.
