const RUBRIC = [
  {
    id: 'shared_values_respect',
    label: 'Maintains a climate of shared values, ethical conduct, and mutual respect.',
    levels: {
      2: 'Done: Maintains a professional, ethical, respectful, and patient-centered climate.',
      1: 'Partially Done: Shows some professionalism or respect, but evidence is incomplete or inconsistent.',
      0: 'Not Done: Disrespectful, dismissive, unethical, or absent.'
    }
  },
  {
    id: 'roles_expertise',
    label: "Uses knowledge of own role and team member's expertise to address patient outcomes.",
    levels: {
      2: "Done: Uses own role and the dental colleague's expertise appropriately to support patient outcomes.",
      1: 'Partially Done: Mentions role or team expertise, but connection to patient outcomes is incomplete.',
      0: 'Not Done: No evidence of role awareness or interprofessional responsibility.'
    }
  },
  {
    id: 'responsive_respectful_communication',
    label: 'Communicates in a responsive, responsible, respectful and compassionate manner with team member.',
    levels: {
      2: 'Done: Communicates clearly, responsibly, respectfully, and compassionately with the team member.',
      1: 'Partially Done: Communication is present but may be vague, incomplete, or only minimally responsive.',
      0: 'Not Done: Communication is unclear, dismissive, inappropriate, or breaks down.'
    }
  },
  {
    id: 'teamwork_principles',
    label: 'Applies values and principles of teamwork during team interaction.',
    levels: {
      2: 'Done: Demonstrates collaboration, shared care planning, and appropriate teamwork behaviors.',
      1: 'Partially Done: Some teamwork is present, but collaboration is passive or incomplete.',
      0: 'Not Done: No teamwork behaviors are demonstrated.'
    }
  },
  {
    id: 'situation',
    label: "Describes/Discusses patient's situation.",
    levels: {
      2: 'Done: Describes the patient situation clearly, including the reason for transfer.',
      1: 'Partially Done: Gives a basic situation but lacks clarity, urgency, or key context.',
      0: "Not Done: Does not describe the patient's situation."
    }
  },
  {
    id: 'background',
    label: 'Describes/Discusses pertinent patient background information.',
    levels: {
      2: 'Done: Provides pertinent patient background information relevant to the transfer.',
      1: 'Partially Done: Provides some background but misses important or relevant details.',
      0: 'Not Done: Does not provide pertinent background.'
    }
  },
  {
    id: 'assessment',
    label: 'Offers an assessment of patient.',
    levels: {
      2: 'Done: Offers a clear and clinically relevant assessment of the patient.',
      1: 'Partially Done: Assessment is present but vague, incomplete, or weakly explained.',
      0: 'Not Done: No assessment is provided.'
    }
  },
  {
    id: 'recommendation',
    label: 'Provides a recommendation for further care of patient.',
    levels: {
      2: 'Done: Provides a specific and actionable recommendation for further care.',
      1: 'Partially Done: Recommendation is present but general, incomplete, or not clearly actionable.',
      0: 'Not Done: No recommendation is provided.'
    }
  }
];

const STRICTNESS = {
  loose: 'This is a summer course. Grade generously. If the response is good enough and supports safe transfer, award Done. Reserve 0 scores for clearly missing or unsafe evidence.',
  balanced: 'Grade fairly. Done requires clear evidence, but minor phrasing issues should not reduce the score when the transcript supports the criterion.',
  strict: 'Grade rigorously. Done requires complete, specific, organized evidence. Use Partially Done for omissions, vague statements, and weak clinical handoff details.'
};

const MAX_SCORE_PER_ITEM = 2;
const MAX_SCORE_10_PER_ITEM = 10;
const MAX_TOTAL_SCORE = 16;
const MAX_TOTAL_SCORE_10 = 80;
const PASSING_SCORE = 12;

module.exports = {
  RUBRIC,
  STRICTNESS,
  MAX_SCORE_PER_ITEM,
  MAX_SCORE_10_PER_ITEM,
  MAX_TOTAL_SCORE,
  MAX_TOTAL_SCORE_10,
  PASSING_SCORE
};
