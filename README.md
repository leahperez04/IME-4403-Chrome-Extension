# Conversation Notes

Conversation Notes is a Chrome extension for turning recorded or pasted lecture transcripts into editable study notes, flashcards, and practice quizzes. It can use an uploaded notes sample to guide the organization and appearance of generated notes.

> **Chrome Web Store:** Add the official listing link here after the extension is published.

## Features

- Record speech through your microphone and edit the resulting transcript, or paste in a transcript.
- Generate English study notes and download them as a PDF.
- Optionally upload a notebook photo or text sample to guide note structure and style.
- Generate flashcards or a practice quiz separately from the same transcript and notes.
- Save conversations in folders and return to them later.
- Run note and study-material generation with Chrome's built-in AI on supported computers.

## Requirements

- Desktop Google Chrome 138 or newer.
- A computer, browser configuration, and available storage that support Chrome's built-in AI model.
- Chrome may need to download its AI model the first time. Availability and generation speed depend on the device and Chrome setup.

If the AI model is unavailable, recording, transcript editing, folders, and exports can still be used. The extension does not silently switch to a hosted AI provider.

## Install from the Chrome Web Store

1. Open the official Conversation Notes listing in the Chrome Web Store.
2. Select **Add to Chrome** and review the permissions prompt.
3. Select the Extensions puzzle-piece icon in Chrome and pin **Conversation Notes** for easy access.
4. Select the extension icon to open its main page.

## Use the extension

### Record or add a transcript

1. Get permission from everyone before recording.
2. In the recording controls, select the spoken language before you start. The available speech-recognition choices include English (US/UK), Spanish, French, German, and Hindi.
3. Select **Start recording** and allow microphone access if Chrome asks. Recording captures microphone audio; it does not capture audio playing in another tab or on the computer.
4. Select **Pause** as needed, then **Stop & save**. You can also paste a transcript into the transcript editor.
5. Review and edit the transcript before generating study materials.

### Generate notes in your preferred style

1. Optionally select **Upload sample** under **Your note style**. Supported references are JPG, PNG, or WebP notebook images, or text-based PDF, TXT, or Markdown files.
2. Select **Generate PDF notes**. Generated notes appear in the editor, and a PDF downloads when generation finishes.
3. Review and edit the notes, then select **Download PDF** to export your latest version.

A style sample guides formatting and organization; lecture facts should come from the transcript. The extension may misread handwriting and does not recreate handwriting or an exact page layout. Generated notes are in English.

### Make flashcards or a practice quiz

- Select **Generate flashcards** to create a saved set from the transcript and notes. Click a card to reveal its answer; use **Previous**, **Next**, or **Shuffle** to study, or select **Export set** for a text copy.
- Select **Create quiz** to make multiple-choice and true/false questions from the same sources. Choose an answer and select **Check answer** to see feedback and an explanation. Move through the quiz, finish to see your score, or retake it.

The two study tools have separate buttons, so you can generate one at a time. Review AI-generated notes, questions, and answers for accuracy. If you edit a transcript or notes, regenerate its flashcards or quiz to refresh the material.

### Work while a task runs

The extension opens its main interface in a regular Chrome tab. You can switch to other tabs while a task runs, but keep the Conversation Notes tab open until generation finishes. Closing that tab cancels the current task. Keep Chrome running and the computer awake while recording or generating.

### Organize conversations

Use **New folder** in **Conversation library** to create a folder. **Show folder** filters the library, and **Move to folder** files the open conversation. Select a saved conversation to reopen it.

## Privacy and data

Audio, transcripts, uploaded samples, notes, folders, flashcards, and quizzes are stored locally by the extension. Note and study-material generation uses Chrome's on-device AI when supported. Live speech recognition may be processed through an online Chrome speech service. Uninstalling the extension or clearing its storage can delete saved content; export important transcripts and PDFs first.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Download the PDF user guide](docs/Conversation_Notes_User_Guide.pdf)
- [Release notes and usage instructions](RELEASE_NOTES.md)
