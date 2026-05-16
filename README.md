# Patient Transfer Grading Support Tool v0.3.3

Electron grading support tool for the SBAR patient transfer activity.

## What changed in v0.3.3

- The overall interface look and feel remains the same.

- Each grading run now creates a dedicated subfolder inside the selected output folder named `Patient-Transfer-Grading-<date>-<time>`.
- Confirmed CSV and XLSX behavior: `Needs Revision` is `Yes` when the student earns less than 16/16 and `No` when the student earns 16/16.
- Replaced the main panel title and text with system-use instructions.
- Updated the rubric scale to match the attached Collaborative Care Assessment Rubric: 2 = Done, 1 = Partially Done, 0 = Not Done.
- Updated the maximum score to 16 points.
- Updated the passing threshold to 12 out of 16 points.
- Updated the grading prompt so the API returns only 2, 1, or 0 for each rubric item.
- Added a **Needs Revision** column to the CSV and XLSX exports only.
- In CSV and XLSX only, **Needs Revision** is marked **Yes** when the student earns less than 16 out of 16 points and **No** when the student earns full marks.
- Kept the Word report as a DOCX report without the extra Needs Revision export column.
- API-only grading is preserved. No local heuristic fallback is included.

- Added precise grading comments that begin with positive feedback and then identify point deductions using the `(-x)` format.
- Removed generic deduction comments such as “did not fully demonstrate all elements of this rubric item.”
- Added GitHub Actions support for Windows and macOS installer builds.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Build installers

```bash
npm run dist
```

## Required settings

The app requires:

- API base URL
- Model name
- API key

The API key is stored locally on the user's computer through `electron-store`. It is not bundled in the application source.

## Workflow

1. Open the app.
2. Confirm or paste the API key in Settings.
3. Select the transcript folder.
4. Select the output folder.
5. Click **Grade All**.
6. The app saves the grading outputs automatically inside a new run folder within the selected output folder.

## Output files

Each grading run creates a folder named `Patient-Transfer-Grading-<date>-<time>` containing:

- Canvas-style CSV file
- Canvas-style XLSX file
- Word grading report (.docx)

## API-only grading

This version does not include local heuristic grading. All grading must come from the configured API. If the API request fails, the transcript remains ungraded and the row shows an API error.


## v0.2.5 update

If multiple transcript files have the same parsed student name, the app grades only the first file and records the repeated files in the execution log as not processed due to repetition.


Version 0.2.5 updates:
- Execution log is now generated as CSV.
- Transcript table status column wraps long messages so Total and Pass remain visible.


## v0.3.3 update

- Revised rubric comments so partial-credit comments begin with a specific positive observation.
- Deduction explanations now begin with the point-loss marker, such as `(-1)`, after the positive observation.
- Removed generic fallback comments such as “did not fully demonstrate all elements of this rubric item.”
- Added rubric-specific fallback language when the model response is incomplete or overly generic.
