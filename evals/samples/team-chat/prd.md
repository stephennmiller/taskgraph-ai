# Team Chat Platform

## Overview

A team messaging product for companies of 10 to 500 people: channels, direct messages, threads, search, file sharing and integrations. It ships as a web app first, with desktop wrappers later. This PRD covers the first public release.

## Goals

- Teams move their day-to-day conversation off email within their first week.
- Messages appear for everyone in a channel within 300 ms.
- An admin can set up a workspace and invite the team in under five minutes.

## Non-Goals

Voice and video calls, end-to-end encryption, and federation between workspaces are not part of this release.

## Users and Roles

- **Owner**: created the workspace; manages billing and can delete the workspace.
- **Admin**: manages members, channels and integrations.
- **Member**: joins channels, sends messages, uploads files.
- **Guest**: sees only the channels they are invited to; cannot create channels.

## Feature Areas

### Workspaces and Onboarding

- Sign up with email and password or Google; verify the email address.
- Create a workspace with a name and a URL slug.
- Invite people by email or with an invite link that expires after 7 days.
- A first-run checklist: create a channel, invite a teammate, send a message.

### Channels

- Public channels anyone in the workspace can join, and private channels by invitation.
- Channel name, topic and description; rename and archive.
- `#general` exists in every workspace and cannot be archived.
- Members can mute a channel and star it to pin it in the sidebar.

### Messaging

- Send messages with Markdown formatting, mentions of people (`@name`) and channels (`#channel`), and emoji.
- Edit and delete your own messages; the edit is marked.
- Reactions with any emoji.
- Typing indicators and online presence.
- Messages arrive in real time over WebSockets; a client that reconnects receives what it missed.

### Threads

- Reply to any message in a thread.
- A thread can be followed; followers are notified of new replies.
- A reply can also be posted to the channel.

### Direct Messages

- One-to-one and group direct messages of up to 8 people.
- Direct messages are private to their participants, including from admins.

### Notifications

- Desktop and mobile web push notifications for mentions, direct messages and followed threads.
- Per-channel notification settings: all messages, mentions only, or nothing.
- Do-not-disturb hours, set per user.
- An email digest of unread mentions after 24 hours away.

### Search

- Full-text search over messages and file names the user can see.
- Filters: in a channel, from a person, before or after a date, has a file.
- Results appear within 1 second for workspaces with up to 10 million messages.

### Files

- Upload files up to 1 GB by drag-and-drop or paste.
- Image previews and PDF previews inline.
- Files inherit the visibility of the channel or conversation they were shared in.

### Integrations

- Incoming webhooks post messages to a channel.
- Slash commands call an external URL and post its answer.
- A GitHub integration posts pull request and issue events to a chosen channel.

### Administration

- Admins can deactivate members, which signs them out everywhere.
- Message retention policy: keep forever, or delete after a set number of days.
- Export all public channel history as JSON.
- An audit log of admin actions.

### Billing

- Free plan: up to 10,000 visible messages and 5 GB of files.
- Paid plan billed per active member per month through Stripe.
- Owners see invoices and change the payment method.

## Technical Constraints

- Web client in TypeScript and React; the server in TypeScript on Node.js.
- PostgreSQL for primary data; search in OpenSearch; files in S3-compatible storage.
- Every API is also available to integrations through a documented REST API with tokens.
- WCAG 2.2 AA accessibility for the web client.

## Security and Compliance

- Passwords hashed with Argon2id; sessions expire after 30 days of inactivity.
- All traffic over TLS; files served through signed URLs that expire.
- SOC 2 controls are a goal for the following release; log what an audit will need.

## Performance

- 5,000 concurrent connections per server node.
- Sending a message is acknowledged within 150 ms at p95.

## Release Plan

A private beta with five design-partner companies, then public launch. Feature flags gate integrations and billing until launch.

## Open Questions

- Do guests count as paid members?
- Should message edits keep a visible history?
