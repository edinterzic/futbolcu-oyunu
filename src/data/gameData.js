// Auto-generated central data export
import { TEAMS } from "./teams";
import { PLAYERS } from "./players";
import { ANSWER_INDEX } from "./answerIndex";

export { TEAMS, PLAYERS, ANSWER_INDEX };

export function getPairKey(teamA, teamB) {
  return teamA < teamB ? `${teamA}|${teamB}` : `${teamB}|${teamA}`;
}

export function getAnswers(teamA, teamB) {
  const key = getPairKey(teamA, teamB);
  return ANSWER_INDEX[key] || [];
}
