# Imali AI book: the shop book that reads on the device

Imali AI runs sales, stock and books on WhatsApp for shop owners and merchants, along with their suppliers, their funders and groups of companies. This repository is a Chrome web app built for the #BuildHybridAI hackathon. It is a counter book that a shop owner writes in plain words. Gemini Nano reads each entry on the device through Firebase AI Logic, and a cloud Gemini model is asked only when the device's reading fails a check.

![The book after the six examples, the sample receipt and one question](docs/screenshots/book-1280.png)

The same screen at phone width is in [docs/screenshots/book-390.png](docs/screenshots/book-390.png).

## Why a shop book needs both models

A small shop's book holds its customers' names and what each one owes. Many owners still keep it in a paper exercise book, because a cloud app costs data, needs signal and sends the customers' names to a server. A model on the device answers all three. A small model also makes mistakes with money, and a book that is wrong one time in ten is worse than paper.

We saw this on the first day. On 12 November 2026 Gemini Nano read "Sold two bags of maize meal for 120 rand each" as two bags at R60 each, a total of R120 instead of R240. The arithmetic of its answer was consistent, so a sum check alone would have passed it. The words said "each", and the book's checks caught it there.

So this book never trusts a model with arithmetic, and it never sends the whole book anywhere. Gemini Nano reads, plain code checks, and the cloud model is the second opinion for the cases the device gets wrong or cannot read.

## How an entry is read

1. **Gemini Nano reads it on the device.** Words go through Firebase AI Logic with `InferenceMode.ONLY_ON_DEVICE` when Chrome's language detector names a language Nano reads, or is unsure, as it often is on a short message. Receipt photos go through `InferenceMode.PREFER_ON_DEVICE`, so the SDK picks Nano when the device has it and the cloud model when it does not. Both engines get the same JSON Schema (`src/ai/prompts.ts`): Nano as the Prompt API's `responseConstraint`, the cloud model as `responseJsonSchema`.
2. **Code checks the reading.** `src/check/checks.ts` runs in microseconds and offline. Each line's quantity times price must equal its line total, and the lines must add up to the total. A price the words mark with "each", "per", "@", "chacun" or "kila mmoja" must be a unit price. Every number must come from the words or follow from them, and the currency must match the one the words name. A sale the words say is paid later must be recorded on credit, and a debt or payment must name the person.
3. **The cloud gives a second opinion only when needed.** If a check fails, or Chrome is sure the words are in a language Nano does not read here (Kiswahili and isiZulu in our tests), the words go to the cloud model with `InferenceMode.ONLY_IN_CLOUD`. Before they leave, `src/privacy/redact.ts` swaps names and phone numbers for placeholders such as `[PERSON_1]`, and swaps them back on the device when the answer returns. The second opinion is told which checks failed, and its answer has to pass the same checks. If it does not, the entry is marked "Needs you" and stays out of the totals.
4. **Offline, the entry waits.** When the cloud cannot be reached, the device's reading is kept with the reason it waits, and it stays out of the totals. When Chrome reports the connection is back, the waiting entries go for their second opinion.
5. **Questions are answered by code.** "How much does Thandi owe?" goes to Nano, which turns it into a small query (what to work out, for whom, for which period). The figures are added up by code from the book in this browser's IndexedDB. When the cloud has to read a question, it gets the question alone, with names removed, and never a record.

Every model step is shown in the app under "Where it ran", with the model, the time it took and what left the device, and the ledger counts device and cloud steps.

## How Firebase is used

| Firebase product | What it does here | Code |
| --- | --- | --- |
| Firebase AI Logic | `getAI(app, { backend: new GoogleAIBackend() })` and `getGenerativeModel` with `mode`, `onDeviceParams` and `inCloudParams`. Gemini Nano in Chrome on the device and the Gemini Developer API in the cloud. `response.inferenceSource` records where each call ran. `initializeDeviceModel` downloads Nano after the owner clicks. | `src/ai/hybrid.ts` |
| App Check | Required by AI Logic. reCAPTCHA Enterprise on the hosted site, the debug provider on a developer's machine. | `src/ai/firebase.ts` |
| Remote Config | `cloud_model`, `second_opinion_model`, `second_opinion` and `max_cloud_calls_per_day`, so the cloud models and the daily cap change without a release. | `src/ai/firebase.ts` |
| Hosting | Serves the judges' copy. The app also installs as a web app and keeps working offline. | `public/sw.js` |

## What we measured

These runs were on 12 November 2026, in Chrome 157 on a Linux machine with 4 processor cores and no graphics card, so Gemini Nano ran on the processor. The first model download took 274 seconds.

| Entry or question | On the device | Time |
| --- | --- | --- |
| Sold 3 loaves at R15 each to Thandi, she pays Friday | On credit, R45, Thandi, Friday. Checked. | 10 s |
| Thandi paid R30 | Paid back, R30. Checked. Chrome's detector guessed Hindi at 0.55, so Nano tried it first. | 8 s |
| Paid R200 for the electricity token | Expense, R200. Checked. | 7 s |
| Sold two bags of maize meal for 120 rand each | 2 at R60 in one run: the "each" check failed, so it waited for the second opinion. Right (R240) in a later run. | 7 s |
| Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa | Kiswahili, which Nano does not read here, so it goes to the cloud with Juma's name removed. | |
| Vendu 2 sacs de riz à 5000 FCFA chacun à Awa, elle paie samedi | On credit, CFA 10,000, Awa, samedi. Checked. | 12 s |
| The sample receipt photo (four lines) | Stock bought, R975, every line right. Checked. | 20 s |
| How much does Thandi owe? | Thandi owes you R15. | 4 s |
| Who owes me money? | 2 people owe you R15 and CFA 10,000. | 4 s |

Gemini Nano's answers vary from run to run, which is why every reading goes through the checks. The names, shops and receipt in this repository and its film are made up for the demo.

## Try it

The judges' copy will be linked here once it is on Firebase Hosting. It will be free to use with no sign-in. Until then, run it yourself as below.

1. Open it in Chrome on a computer: Windows 10 or 11, macOS 13 or later, Linux, or a Chromebook Plus, with at least 22 GB free disk and either a graphics card with more than 4 GB of memory or 16 GB of RAM and 4 processor cores ([Chrome's requirements](https://developer.chrome.com/docs/ai/get-started)).
2. If the header says Gemini Nano is not downloaded, click **Get it**. The download runs once and then works offline. Without Nano, every reading goes to the cloud with names removed, and the app still works.
3. Click the example entries in order, then **Receipt photo** and **Use a sample receipt**, then **Ask the book**.
4. To see the offline queue, turn the network off in Chrome's developer tools (Network, Offline), add the maize meal example, then turn it back on.

## Run it yourself

You need Node.js 20 or later and a Firebase project with AI Logic set up for the Gemini Developer API.

```sh
npm install
cp .env.example .env   # fill in your Firebase web app config
npm run dev            # http://127.0.0.1:5191
npm test               # the checks, the name removal and the answers
npm run build          # type check and production build into dist/
```

Without a `.env` the app still runs and reads on the device; the cloud steps then wait.

On your own machine, App Check uses its debug provider: copy the debug token from Chrome's console into the Firebase console under App Check, Manage debug tokens. Never commit a token.

## What was built during the hackathon

Every file in this repository was written from 12 November 2026, inside the contest period. Imali AI itself was built from March 2026, tested and piloted with users from April 2026, and launched on 21 October 2026, as a WhatsApp product that runs its model calls in the cloud. None of that product's code is in this repository. From it we reused the brand (the logo and the Barlow font files), the product idea of a book kept from plain words, and what we learned about how shop owners write their entries. The on-device reading, the checks, the name removal, the routing between Nano and the cloud, the offline queue, the question answering and this interface are new.

## Licence

The code is under the Apache License 2.0 (`LICENSE`). The Barlow fonts are under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`). The Imali AI name and logo are not covered by either licence.

Records you own.
