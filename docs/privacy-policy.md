# Privacy Policy

Last updated: August 9, 2026

Give Yourself a Raise is a personal finance dashboard built for the account owner to connect their own bank accounts, review transactions, and analyse spending patterns.

## What data the app uses

- Bank account and transaction data that you explicitly authorise through Enable Banking
- Basic technical data needed to complete the authorisation flow, such as browser headers and callback state

## What the app does with the data

- Retrieves account balances and transactions after you approve access
- Uses the data to display spending summaries, category analysis, and savings progress
- Encrypts the Enable Banking session identifier with AES-256-GCM and binds it to your Clerk user ID
- Fetches raw balances and transactions on demand instead of persisting them in the application database
- Sends only the result of an authorised tool call to ChatGPT

## Data sharing

- Bank connectivity is provided by Enable Banking and user identity by Clerk
- ChatGPT processes tool results when you choose to invoke the connected app
- No transaction data is sold or shared with third parties for advertising

## Data retention

- Disconnecting revokes the Enable Banking session and deletes the encrypted connection record
- You can revoke ChatGPT access from your Clerk account or ChatGPT settings

## Contact

For privacy questions, contact: colmquish@gmail.com
