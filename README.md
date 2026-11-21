# TechWomen AZ Mentoring

The standalone demo starts with an empty workspace. Create a profile with a unique username and choose your role. Create another profile in the same browser to try messaging. Use New message to search by username and select one or more recipients.

- **Messages** supports direct and group conversations with at least one mentor and one mentee. Use **Schedule** in a conversation to preselect its participants for a follow-up.
- **People** recommends mentors from existing profiles when interests in their story or focus overlap with a mentee’s story. Shared meeting preferences improve ranking. The app displays the overlap without sharing the full story.
- **Calendar** shows public events to signed-in workspace members. Private events appear only for the owner and invited guests. Events may be online or in person.
- **Reminders** appear in the workspace at the chosen time. You can also add an event to Google Calendar or download an `.ics` file with its reminder. Calendar exports are copies. Update the external calendar separately if the meeting changes.
- **AI Assistant** can summarize a conversation, draft a reply, or suggest follow-up steps. The preview uses built-in suggestions. Live AI requires the server-side `OPENAI_API_KEY` secret. A member explicitly confirms before the assistant sends recent messages to the provider. Generated drafts need a separate send action.

## Start the account-enabled workspace

Install Node.js 22.13 or later. On Windows, open **Start TechWomen AZ.cmd** from the extracted folder. You can also open a terminal in the folder and run the following command.

```sh
npm start
```

Open **http://127.0.0.1:4173/**. Create an account with your email address and a password, then pick your mentor or mentee role. Accounts, chats, and calendars are stored in `.data/workspace.sqlite`. Preserve this database when moving or backing up the app.

For the classic sample workspace with a local database, run the following command.

```sh
node local.mjs
```

Open **http://127.0.0.1:4173/**. Local demo changes are stored in `.data/demo.sqlite` on your device.

Run `npm test` to verify the workspace and account flows with a temporary database.
Use `node build-demo.mjs "TechWomen AZ Demo.html"` to rebuild the standalone file.

## Enable Google sign-in

1. Create a **Web application** OAuth client for TechWomen AZ in Google Cloud. On the consent screen, configure the app name and audience.
2. Add the exact callback for the address where the account-enabled app runs. For the local server, use `http://127.0.0.1:4173/auth/google/callback`. For a hosted server, append `/auth/google/callback` to its HTTPS origin.
3. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Restart the app. For hosting, put the values in the host’s secret settings and set `APP_ORIGIN` to the exact public HTTPS origin. If using a proxy, forward the public `Host` header.

**Continue with Google** creates an account the first time. If you already signed up with a password, sign in with that password and select **Connect Google account** in your workspace profile. Use the Google account with the same email address. [Google’s web sign-in setup guide](https://developers.google.com/identity/openid-connect/openid-connect#settingup).

## Private ChatGPT Site build

The optional Sites build uses ChatGPT sign-in and the Site’s access policy. The account-enabled Node.js build above is the one that supports its own email/password accounts and direct Google sign-in. The calendar’s **Public** setting shares an event with members who can open that workspace.

Run `node build.mjs` to build the Sites Worker. The `DB` binding stores profiles, messages, events, and reminder read state. The initial D1 migration is in `drizzle/0000_workspace.sql`. Configure the optional `OPENAI_API_KEY` secret through the hosting settings. `OPENAI_MODEL` can override the default model.
