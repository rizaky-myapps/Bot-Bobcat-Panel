import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AtmMission, ConvoiMission, PatrolSession, PdsSession, SecuMission } from '../src/db/models/index.js';
import { renderPatrol, renderPatrolTimeBoard } from '../src/bot/renderers/patrol.js';
import { renderAtm, renderConvoi, renderPds } from '../src/bot/renderers/missions.js';
import { renderSecuDay, renderSecuHeader, renderSecuInfo } from '../src/bot/renderers/secu.js';
import { renderSeparator } from '../src/bot/commands/separateur.js';
import { buildSecuDays } from '../src/db/services/secuPlanning.js';

// Les builders discord.js valident les données à la sérialisation : un rendu invalide lève une erreur.
function serialize(payload) {
  return JSON.parse(
    JSON.stringify({
      ...payload,
      embeds: payload.embeds?.map((e) => e.toJSON()),
      components: payload.components?.map((c) => c.toJSON()),
    }),
  );
}

const userId = '123456789012345678';
const now = new Date();

function patrol(version, status = 'OPEN') {
  return new PatrolSession({
    guildId: '1',
    channelId: '2',
    authorId: userId,
    version,
    unit: 'Alpha 1',
    agents: [`<@${userId}>`, '1234'],
    agentIds: [userId],
    dateLabel: 'Jeudi 29/10/2026',
    startAt: new Date(now.getTime() - 3600_000),
    endAt: status === 'FINISHED' ? now : null,
    status,
    places: [
      { name: 'Superette', emoji: '🏪', arrivedAt: new Date(now.getTime() - 3000_000), leftAt: new Date(now.getTime() - 2000_000), leaveReason: 'RAS' },
      { name: 'Banque', emoji: '<:bank:123456789012345678>', arrivedAt: new Date(now.getTime() - 1000_000) },
    ],
  });
}

test('rendu des patrouilles v1 et v2', () => {
  for (const version of ['v1', 'v2']) {
    for (const status of ['OPEN', 'FINISHED']) {
      const json = serialize(renderPatrol(patrol(version, status)));
      assert.ok(json.components || json.embeds);
      if (version === 'v2') assert.equal(json.flags, 1 << 15);
      if (status === 'OPEN' && version === 'v1') assert.equal(json.components[0].components.length, 4);
    }
  }
});

test('rendu du tableau de temps', () => {
  const board = {
    year: 2026,
    week: 44,
    range: { start: new Date(2026, 9, 26), end: new Date(2026, 10, 2) },
    rows: [],
    available: [
      { name: 'Superette', emoji: '🏪', usedMinutes: 120, maxMinutes: 300, remaining: 180, percent: 40, unlimited: false, reached: false },
      { name: 'Port', emoji: '⚓', usedMinutes: 30, maxMinutes: 0, remaining: null, percent: null, unlimited: true, reached: false },
    ],
    reached: [{ name: 'Station', emoji: '⛽', usedMinutes: 300, maxMinutes: 300, remaining: 0, percent: 100, unlimited: false, reached: true }],
    totalMinutes: 450,
  };
  board.rows = [...board.available, ...board.reached];
  const json = serialize(renderPatrolTimeBoard(board));
  const text = JSON.stringify(json);
  assert.ok(text.includes('[████████░░░░░░░░░░░░] 40%'));
  assert.ok(text.includes('Limite atteinte'));
});

test('rendu ATM, convoi et PDS', () => {
  const base = {
    guildId: '1',
    channelId: '2',
    messageId: '3',
    createdBy: userId,
    scheduledAt: now,
    availability: [
      { userId, status: 'AVAILABLE' },
      { userId: '223456789012345678', status: 'UNAVAILABLE' },
    ],
    participants: [{ userId, roles: ['CHEF_OP', 'FUSIL'] }],
  };
  const atm = new AtmMission({ ...base, frequency: 'S7', mentionRoleId: '323456789012345678' });
  const atmJson = serialize(renderAtm(atm, { withMention: true }));
  assert.ok(atmJson.content.includes('<@&323456789012345678>'));
  assert.equal(atmJson.components[0].components.length, 3);
  atm.status = 'CANCELLED';
  atm.cancelReason = 'Météo';
  assert.equal(serialize(renderAtm(atm)).components.length, 0);

  const convoi = new ConvoiMission({ ...base, participants: [{ userId, roles: ['ESCORTE'] }], reschedules: [{ from: now, to: now, by: userId }] });
  assert.equal(serialize(renderConvoi(convoi)).components[0].components.length, 4);

  const pds = new PdsSession({
    guildId: '1',
    channelId: '2',
    atmMissionId: new mongoose.Types.ObjectId(),
    createdBy: userId,
    plate: 'ZJR 325',
    atms: [{ label: 'ATM Legion', note: 'RAS', photos: [{ url: 'https://example.com/a.png' }] }],
  });
  const pdsJson = serialize(renderPds(pds, atm));
  assert.equal(pdsJson.embeds[0].image.url, 'https://example.com/a.png');
});

test('rendu des sécurisations', () => {
  const { days } = buildSecuDays({ daysSpec: '17/08:2', template: '19h-01h/2h', capacity: 2, ref: new Date(2026, 7, 1) });
  const mission = new SecuMission({
    guildId: '1',
    channelId: '2',
    createdBy: userId,
    lieu: 'Casino',
    vehicule: 'custom',
    vehiculeCustom: 'Granger',
    radio: 'SIERRA_3',
    capacity: 2,
    briefOffset: 15,
    pdsChannelId: '4',
    days,
  });
  mission.days[0].slots[0].registrations.push({ userId }, { userId: '223456789012345678' });
  serialize(renderSecuHeader(mission));
  serialize(renderSecuInfo(mission, 'https://discord.com/channels/1/2/3'));
  const day = serialize(renderSecuDay(mission, mission.days[0], new Date(2026, 7, 1)));
  assert.equal(day.components[0].components.length, 3);
  assert.equal(day.components[0].components[0].style, 4); // complet → rouge
  assert.ok(day.components[0].components[0].custom_id.length <= 100);
});

test('rendu du séparateur', () => {
  serialize(renderSeparator('Patrouilles'));
  serialize(renderSeparator());
});
