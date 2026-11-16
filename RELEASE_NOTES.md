# Release notes and usage instructions

## Version 0.9.6

Conversation Notes brings lecture transcripts, personal note organization, and study tools together in one Chrome extension.

### What's included

- Record microphone audio or paste a transcript, then review and edit the transcript.
- Generate editable English lecture notes and export them as a PDF.
- Upload a notebook image or text-based sample to guide note formatting and organization.
- Generate a flashcard set or a multiple-choice and true/false practice quiz from the transcript and notes. Each tool runs separately.
- Organize saved conversations with folders.
- Use Chrome's built-in AI on supported computers without an extension account or developer API key.

### Improvements in 0.9.6

- The main interface opens in a regular tab, so you can switch to other Chrome tabs while generation runs.
- The on-device AI session is reused between study tasks while the main interface remains open.
- Default study-set sizes are limited to 12 flashcards and 8 quiz questions to reduce generation time.

### Note-style improvements in 0.9.5

- Note formatting is guided by a concise style profile from the uploaded sample.
- Style cues are separated from lecture facts, so sample content is not used as a source for the lecture notes.
- PDF samples provide text cues and a preview of the first page for style analysis.

## How to install

After the Chrome Web Store listing is published:

1. Open the official **Conversation Notes** listing in the Chrome Web Store.
2. Select **Add to Chrome** and review the requested permissions.
3. Pin the extension from Chrome's Extensions menu, then select its icon to open it.

The minimum supported browser version is desktop Chrome 138. Chrome's built-in AI must also be available on the computer. Chrome may download the model the first time it is used.

## How to use

1. **Add lecture content.** Get permission from everyone before recording. Choose a spoken language, select **Start recording**, and allow microphone access if prompted. Recording captures microphone audio only, not the audio in another Chrome tab. You can also paste a transcript.
2. **Review the transcript.** Select **Stop & save**, then correct any speech-recognition errors in the transcript editor.
3. **Optionally add a note-style example.** Under **Your note style**, select **Upload sample** and choose a clear JPG, PNG, or WebP notebook photo, or a text-based PDF, TXT, or Markdown file.
4. **Generate lecture notes.** Select **Generate PDF notes**. Review and edit the notes in the editor, then select **Download PDF** to export the latest version.
5. **Choose a study tool.** Select **Generate flashcards** or **Create quiz**. Flashcards flip to reveal answers. In a quiz, choose an answer and select **Check answer** to see feedback and an explanation. Finish to view your score or retake the quiz.
6. **Organize your work.** Use **New folder**, **Show folder**, and **Move to folder** in **Conversation library** to sort conversations.

## Important usage notes

- You can switch to other Chrome tabs while recording or generating. Keep Chrome open and the computer awake.
- Keep the Conversation Notes main tab open until notes, flashcards, or a quiz finish. Closing that tab cancels its current generation task.
- AI-generated material can contain mistakes. Review the transcript, notes, and study questions before relying on them.
- Live speech recognition may be processed through an online Chrome speech service. Note and study-material generation uses Chrome's on-device AI when supported.
- Audio, transcripts, samples, notes, folders, and study sets are saved locally. Export important transcripts and PDFs before uninstalling the extension or clearing Chrome extension storage.

For more detail, see the [user guide](docs/USER_GUIDE.md) or [download the PDF guide](docs/Conversation_Notes_User_Guide.pdf).
