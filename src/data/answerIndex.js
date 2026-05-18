// Auto-generated from admin panel
// Generated: 2026-05-18T23:32:11.958Z

import { TEAMS } from './teams';

export const ANSWER_INDEX = {

};

export function getPairKey(teamA, teamB) {
  return [teamA, teamB]
    .sort((a, b) => TEAMS.indexOf(a) - TEAMS.indexOf(b))
    .join('|');
}

export function getAnswers(teamA, teamB) {
  return ANSWER_INDEX[getPairKey(teamA, teamB)] || [];
}
