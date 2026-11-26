import { describe, expect, it } from 'vitest';
import { voiceProblem, VOICE_PROBLEM_KEY, type VoiceAccess } from '../src/discord/voicePermissions.js';
import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';

const ok: VoiceAccess = {
  viewChannel: true,
  connect: true,
  speak: true,
  moveMembers: false,
  muteMembers: false,
  isStage: false,
  userLimit: 0,
  memberCount: 3,
};

describe('voiceProblem', () => {
  it('allows a normal channel with View Channel, Connect and Speak', () => {
    expect(voiceProblem(ok)).toBeNull();
  });
  it('reports a private channel the bot cannot see first (Discord denies everything without it)', () => {
    expect(voiceProblem({ ...ok, viewChannel: false })).toBe('viewChannel');
  });
  it('reports missing Connect and Speak', () => {
    expect(voiceProblem({ ...ok, connect: false })).toBe('connect');
    expect(voiceProblem({ ...ok, speak: false })).toBe('speak');
  });
  it('reports a full channel unless the bot can move members', () => {
    expect(voiceProblem({ ...ok, userLimit: 3, memberCount: 3 })).toBe('full');
    expect(voiceProblem({ ...ok, userLimit: 3, memberCount: 3, moveMembers: true })).toBeNull();
    expect(voiceProblem({ ...ok, userLimit: 5, memberCount: 3 })).toBeNull();
  });
  it('stage channels need Mute Members to speak', () => {
    expect(voiceProblem({ ...ok, isStage: true })).toBe('stageSpeak');
    expect(voiceProblem({ ...ok, isStage: true, muteMembers: true })).toBeNull();
  });
  it('every problem has a message in both languages that names the channel', () => {
    for (const key of Object.values(VOICE_PROBLEM_KEY)) {
      expect(es[key]).toContain('{channel}');
      expect(en[key]).toContain('{channel}');
    }
    expect(es['voice.missingView']).toMatch(/Ver canal/);
    expect(es['voice.missingConnect']).toMatch(/Conectar/);
  });
});
