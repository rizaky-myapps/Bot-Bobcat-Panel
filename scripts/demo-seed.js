// Remplit la base avec des données fictives pour découvrir le panel sans le bot.
// Usage : node scripts/demo-seed.js [--force]
// Refuse de s'exécuter si le serveur GUILD_ID contient déjà des données (sauf --force).
import { config } from '../src/utils/config.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import {
  AtmMission,
  AuditLog,
  BotHeartbeat,
  ConvoiMission,
  DiscordGuildCache,
  DiscordMember,
  PatrolPlace,
  PatrolSession,
  PdsSession,
  SecuMission,
} from '../src/db/models/index.js';
import { syncSessionTracking } from '../src/db/services/patrolTime.js';
import { buildSecuDays } from '../src/db/services/secuPlanning.js';
import { addDays, addMinutes, formatDateShort, formatLongDate, startOfDay } from '../src/utils/times.js';

const guildId = config.discord.guildId;
if (!guildId) {
  console.error('GUILD_ID manquant dans .env');
  process.exit(1);
}

await connectDatabase();
const existing = await PatrolSession.countDocuments({ guildId });
if (existing && !process.argv.includes('--force')) {
  console.error(`Le serveur ${guildId} contient déjà ${existing} patrouille(s). Relance avec --force pour ajouter les données de démo quand même.`);
  await disconnectDatabase();
  process.exit(1);
}

const base = 100000000000000000n;
const id = (n) => String(base + BigInt(n));
const agents = [
  ['Cpt. Marcus Reed', 'marcus'],
  ['Lt. Sofia Alvarez', 'sofia'],
  ['Sgt. Noah Brooks', 'noah'],
  ['Agt. Lena Moreau', 'lena'],
  ['Agt. Yanis Haddad', 'yanis'],
  ['Agt. Chloé Martin', 'chloe'],
  ['Agt. Ethan Clarke', 'ethan'],
  ['Agt. Inès Benali', 'ines'],
  ['Agt. Hugo Lefèvre', 'hugo'],
  ['Recrue Tom Garnier', 'tom'],
].map(([displayName, username], i) => ({ userId: id(i + 1), displayName, username }));
const roles = [
  { id: id(901), name: 'Direction', color: 0xf5a623, position: 10 },
  { id: id(902), name: 'Superviseur', color: 0xe74c3c, position: 9 },
  { id: id(903), name: 'Agent de sécurité', color: 0x3498db, position: 8 },
  { id: id(904), name: 'Équipe ATM', color: 0x2ecc71, position: 7 },
  { id: id(905), name: 'Recrue', color: 0x95a5a6, position: 6 },
];
const channels = [
  { id: id(801), name: 'patrouilles', type: 0, position: 1 },
  { id: id(802), name: 'missions-atm', type: 0, position: 2 },
  { id: id(803), name: 'convois', type: 0, position: 3 },
  { id: id(804), name: 'sécurisations', type: 0, position: 4 },
  { id: id(805), name: 'annonces', type: 5, position: 5 },
  { id: id(806), name: 'prises-de-service', type: 0, position: 6 },
];

await DiscordGuildCache.findOneAndUpdate(
  { guildId },
  { name: 'Bobcat Security (démo)', ownerId: agents[0].userId, roles, channels, syncedAt: new Date() },
  { upsert: true },
);
for (const [i, a] of agents.entries()) {
  const roleIds = i === 0 ? [roles[0].id] : i < 3 ? [roles[1].id, roles[2].id] : i === 9 ? [roles[4].id] : [roles[2].id, roles[3].id];
  await DiscordMember.updateOne(
    { guildId, userId: a.userId },
    { $set: { ...a, roleIds, inGuild: true, bot: false, avatarUrl: `https://cdn.discordapp.com/embed/avatars/${i % 6}.png`, syncedAt: new Date() } },
    { upsert: true },
  );
}

const placeDefs = [
  ['Superette', '🏪', 5],
  ['Station-service', '⛽', 4],
  ['Banque Fleeca', '🏦', 6],
  ['Port', '⚓', 0],
  ['Bijouterie', '💎', 3],
  ['Hôpital', '🏥', 0],
  ['Casino', '🎰', 8],
];
const places = [];
for (const [name, emoji, maxHoursPerWeek] of placeDefs) {
  places.push(await PatrolPlace.findOneAndUpdate({ guildId, name }, { guildId, name, emoji, maxHoursPerWeek, active: true }, { upsert: true, returnDocument: 'after' }));
}

const now = new Date();
const mention = (n) => `<@${agents[n].userId}>`;
const units = ['Alpha 1', 'Bravo 2', 'Charlie 3', 'Delta 4'];
let finished = 0;
for (let d = 34; d >= 1; d--) {
  for (let k = 0; k < (d % 3 === 0 ? 2 : 1); k++) {
    const startAt = addMinutes(startOfDay(addDays(now, -d)), (19 + k * 2) * 60 + ((d * 7) % 40));
    const team = [(d + k) % 9, (d + k + 3) % 9].map((n) => n + 1);
    const visits = [];
    let t = addMinutes(startAt, 10);
    for (let v = 0; v < 2 + (d % 3); v++) {
      const place = places[(d + v + k) % places.length];
      const stay = 25 + ((d * 13 + v * 7) % 50);
      visits.push({ placeId: place._id, name: place.name, emoji: place.emoji, arrivedAt: t, leftAt: addMinutes(t, stay), leaveReason: v === 0 ? 'RAS' : '' });
      t = addMinutes(t, stay + 10);
    }
    const session = new PatrolSession({
      guildId,
      channelId: channels[0].id,
      authorId: agents[team[0]].userId,
      version: d % 2 ? 'v1' : 'v2',
      unit: units[(d + k) % units.length],
      agents: [...team.map(mention), `${1200 + d}`],
      agentIds: team.map((n) => agents[n].userId),
      dateLabel: formatLongDate(startAt),
      startAt,
      endAt: addMinutes(t, 5),
      status: 'FINISHED',
      finishedBy: agents[team[0]].userId,
      places: visits,
      lastActivityAt: t,
    });
    await syncSessionTracking(session);
    await session.save();
    finished++;
  }
}
const openStart = addMinutes(now, -70);
await PatrolSession.create({
  guildId,
  channelId: channels[0].id,
  authorId: agents[1].userId,
  version: 'v2',
  unit: 'Alpha 1',
  agents: [mention(1), mention(4), '1342'],
  agentIds: [agents[1].userId, agents[4].userId],
  dateLabel: formatLongDate(openStart),
  startAt: openStart,
  places: [
    { placeId: places[0]._id, name: places[0].name, emoji: places[0].emoji, arrivedAt: addMinutes(openStart, 5), leftAt: addMinutes(openStart, 35), leaveReason: 'Contrôle effectué' },
    { placeId: places[2]._id, name: places[2].name, emoji: places[2].emoji, arrivedAt: addMinutes(openStart, 45) },
  ],
  lastActivityAt: addMinutes(now, -25),
});

const atmAt = addMinutes(startOfDay(addDays(now, 1)), 21 * 60);
const atm = await AtmMission.create({
  guildId,
  channelId: channels[1].id,
  messageId: id(7001),
  createdBy: agents[0].userId,
  dateStr: formatDateShort(atmAt),
  timeStr: '21h',
  scheduledAt: atmAt,
  frequency: 'S7',
  mentionRoleId: roles[3].id,
  availability: [3, 4, 5, 6, 7].map((n) => ({ userId: agents[n].userId, status: 'AVAILABLE' })).concat([{ userId: agents[8].userId, status: 'UNAVAILABLE' }]),
  participants: [
    { userId: agents[0].userId, roles: ['CHEF_OP'] },
    { userId: agents[3].userId, roles: ['CO_ATM'] },
    { userId: agents[4].userId, roles: ['FUSIL', 'CONDUCTEUR'] },
  ],
});
const pastAtmAt = addMinutes(startOfDay(addDays(now, -2)), 20 * 60 + 30);
const pastAtm = await AtmMission.create({
  guildId,
  channelId: channels[1].id,
  messageId: id(7002),
  createdBy: agents[1].userId,
  dateStr: formatDateShort(pastAtmAt),
  timeStr: '20h30',
  scheduledAt: pastAtmAt,
  frequency: 'S6',
  status: 'FINISHED',
  closedAt: addMinutes(pastAtmAt, 150),
  closedBy: agents[1].userId,
  availability: [2, 5, 6, 9].map((n) => ({ userId: agents[n].userId, status: 'AVAILABLE' })),
  participants: [
    { userId: agents[1].userId, roles: ['CHEF_OP'] },
    { userId: agents[5].userId, roles: ['CO_ATM', 'CONDUCTEUR'] },
    { userId: agents[9].userId, roles: ['NOUVEAU'] },
  ],
});
await PdsSession.create({
  guildId,
  channelId: channels[1].id,
  messageId: id(7101),
  atmMissionId: pastAtm._id,
  createdBy: agents[5].userId,
  plate: 'ZJR 325',
  status: 'FINISHED',
  startAt: addMinutes(pastAtmAt, 10),
  endAt: addMinutes(pastAtmAt, 140),
  finishedBy: agents[5].userId,
  participants: pastAtm.participants,
  atms: ['ATM Legion Square', 'ATM Vinewood', 'ATM Del Perro'].map((label, i) => ({
    label,
    note: i === 1 ? 'Écran fissuré, signalé' : '',
    addedBy: agents[5].userId,
    at: addMinutes(pastAtmAt, 30 + i * 35),
    photos: [],
  })),
});

const convoiAt = addMinutes(startOfDay(addDays(now, 3)), 22 * 60);
await ConvoiMission.create({
  guildId,
  channelId: channels[2].id,
  messageId: id(7201),
  createdBy: agents[0].userId,
  dateStr: formatDateShort(convoiAt),
  timeStr: '22h',
  scheduledAt: convoiAt,
  notes: 'Départ dépôt central, arrivée Banque Pacific.',
  availability: [1, 2, 6, 7, 8].map((n) => ({ userId: agents[n].userId, status: 'AVAILABLE' })),
  participants: [
    { userId: agents[1].userId, roles: ['CHEF_CONVOI'] },
    { userId: agents[6].userId, roles: ['CONDUCTEUR_FOURGON'] },
  ],
  reschedules: [{ from: addDays(convoiAt, -1), to: convoiAt, by: agents[0].userId, at: addDays(now, -1) }],
});

const { days } = buildSecuDays({
  daysSpec: `${formatDateShort(addDays(now, 2))}:3`,
  template: '19h-01h/2h',
  planning: `${formatDateShort(addDays(now, 3))}=20h-00h`,
  capacity: 3,
});
days[0].slots[0].registrations = [2, 4, 6].map((n) => ({ userId: agents[n].userId, at: now, by: agents[n].userId }));
days[0].slots[1].registrations = [3, 7].map((n) => ({ userId: agents[n].userId, at: now, by: agents[n].userId }));
days[1].slots[0].registrations = [5].map((n) => ({ userId: agents[n].userId, at: now, by: agents[n].userId }));
await SecuMission.create({
  guildId,
  channelId: channels[3].id,
  headerMessageId: id(7301),
  createdBy: agents[0].userId,
  lieu: 'Casino Diamond',
  tenue: 'TENUE_SECURISATION',
  vehicule: 'offroad',
  radio: 'SIERRA_3',
  capacity: 3,
  daysSpec: '',
  template: '19h-01h/2h',
  briefOffset: 15,
  infoChannelId: channels[4].id,
  pdsChannelId: channels[5].id,
  published: true,
  days,
});

await AuditLog.insertMany(
  [
    ['patrol.create', 'Patrouille Alpha 1 créée (v2)', 1, 'bot', 70],
    ['atm.create', `Mission ATM du ${formatDateShort(atmAt)} créée`, 0, 'bot', 50],
    ['atm.dispatch', 'Rôles attribués : Fusil à pompe, Conducteur', 0, 'bot', 40],
    ['secu.register', 'Inscription TEAM 1 — Casino Diamond', 4, 'bot', 30],
    ['convoi.reschedule', 'Convoi reprogrammé', 0, 'panel', 20],
    ['place.update', 'Lieu Casino modifié', 0, 'panel', 10],
  ].map(([action, summary, n, source, ago]) => ({
    guildId,
    action,
    summary,
    source,
    actorId: agents[n].userId,
    actorName: agents[n].displayName,
    createdAt: addMinutes(now, -ago),
  })),
);
await BotHeartbeat.updateOne({ _id: 'bot' }, { $set: { tag: 'Bobcat#0001 (démo)', guildIds: [guildId], startedAt: now, updatedAt: now } }, { upsert: true });

console.log(`Données de démo créées pour ${guildId} : ${places.length} lieux, ${finished + 1} patrouilles, 2 missions ATM, 1 PDS, 1 convoi, 1 sécurisation.`);
console.log(`Pour te connecter sans Discord : PANEL_DEV_LOGIN=true et PANEL_DEV_USER_ID=${agents[0].userId} (propriétaire du serveur de démo).`);
await disconnectDatabase();
