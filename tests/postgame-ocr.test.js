const test = require('node:test');
const assert = require('node:assert/strict');
const PostgameOCR = require('../public/postgame-ocr');
const Playoffs = require('../public/playoffs-model');
const PlayoffResults = require('../lib/playoff-results');

test('postgame OCR parses KDA and Gold with OCR noise resilience', () => {
  assert.equal(PostgameOCR.parseKda('3/1/6'), '3/1/6');
  assert.equal(PostgameOCR.parseKda('O/2/5'), '0/2/5');
  assert.equal(PostgameOCR.parseKda('12 / 3 / 8'), '12/3/8');
  assert.equal(PostgameOCR.parseKda('0 / 0 / 0'), '0/0/0');
  assert.equal(PostgameOCR.parseKda('bad text'), '0/0/0');

  assert.equal(PostgameOCR.parseGold('8234'), 8234);
  assert.equal(PostgameOCR.parseGold('10,540'), 10540);
  assert.equal(PostgameOCR.parseGold('O'), 0);
  assert.equal(PostgameOCR.parseGold('5230'), 5230);
  assert.equal(PostgameOCR.parseGold('999999'), 0); // Out of bounds rejected
});

test('postgame OCR coordinates match 1920x1080 scoreboard specification', () => {
  const c = PostgameOCR.COORDS;
  assert.equal(c.header.gameTime.x, 915);
  assert.equal(c.header.blueKills.x, 840);
  assert.equal(c.header.redKills.x, 1020);

  // Check 5 rows for blue side
  for (let i = 0; i < 5; i++) {
    const r = c.row('blue', i);
    assert.equal(r.name.y, 232 + i * 138);
    assert.equal(r.name.x, 340);
    assert.equal(r.kda.x, 590);
    assert.equal(r.gold.x, 745);
    assert.equal(r.medal.x, 835);
  }

  // Check 5 rows for red side
  for (let i = 0; i < 5; i++) {
    const r = c.row('red', i);
    assert.equal(r.name.y, 232 + i * 138);
    assert.equal(r.name.x, 1330);
    assert.equal(r.kda.x, 1175);
    assert.equal(r.gold.x, 1080);
    assert.equal(r.medal.x, 985);
  }
});

test('player resolution strips squad prefixes, clan symbols and handles unicode/OCR variations', () => {
  const psits = Playoffs.team('PSITS');
  assert.ok(psits, 'PSITS team found in official catalog');

  // Prefix matching
  const m1 = Playoffs.matchPlayer('SIMP LenXer.', psits.players);
  assert.ok(m1);
  assert.equal(m1.name, 'LenXer.');

  // Clan symbol prefix
  const m2 = Playoffs.matchPlayer('ÁŚ Nocturne', psits.players);
  assert.ok(m2);
  assert.equal(m2.name, 'Nocturne');

  const m3 = Playoffs.matchPlayer('ÁŚ WesternK9', psits.players);
  assert.ok(m3);
  assert.equal(m3.name, 'WesternK9');

  const m4 = Playoffs.matchPlayer('FEX Seffyroth', psits.players);
  assert.ok(m4);
  assert.equal(m4.name, 'Seffyroth');

  const m5 = Playoffs.matchPlayer('NOVA KZO', psits.players);
  assert.ok(m5);
  assert.equal(m5.name, 'KZO');

  const pice = Playoffs.team('PICE');
  assert.ok(pice, 'PICE team found');

  const m6 = Playoffs.matchPlayer('FEX CEEJAY', pice.players);
  assert.ok(m6);
  assert.equal(m6.name, 'CEEJAY');

  const apo = Playoffs.team('APO');
  assert.ok(apo, 'APO team found');

  const m7 = Playoffs.matchPlayer('TAG Del123.', apo.players);
  assert.ok(m7);
  assert.equal(m7.name, 'Del123.');
});

test('PlayoffResults processes direct scoreboard patch without Moonton match ID', () => {
  const p = Playoffs.defaults();
  const state = {
    playoffs: p,
    game: 1,
    bestOf: 3,
    winner: 'blue',
    blue: { name: 'Junior Marketing Executives Society', tag: 'JMES', score: 0, kills: 18, gold: 35000, players: [] },
    red: { name: 'Philippine Society of Information Technology Students', tag: 'PSITS', score: 0, kills: 6, gold: 24000, players: [] }
  };

  const patch = {
    winner: 'blue',
    gameTime: '11:24',
    scene: 'postgame',
    phase: 'RESULT',
    blue: {
      kills: 18,
      gold: 35120,
      players: [
        { name: 'Licorice', role: 'EXP', hero: 'Yu Zhong', kda: '3/1/6', gold: 7120, level: 13 },
        { name: 'flins', role: 'JUNGLE', hero: 'Fanny', kda: '6/0/4', gold: 8900, level: 15 },
        { name: 'Bubblegum', role: 'MID', hero: 'Valentina', kda: '4/1/8', gold: 6850, level: 13 },
        { name: 'cheifûū', role: 'GOLD', hero: 'Claude', kda: '4/2/5', gold: 7450, level: 14 },
        { name: 'why cant u for once', role: 'ROAM', hero: 'Tigreal', kda: '1/2/11', gold: 4800, level: 12 }
      ]
    },
    red: {
      kills: 6,
      gold: 24800,
      players: [
        { name: 'SIMP LenXer.', role: 'EXP', hero: 'Terizla', kda: '1/3/2', gold: 5100, level: 12 },
        { name: 'ÁŚ Nocturne', role: 'JUNGLE', hero: 'Ling', kda: '0/4/1', gold: 5800, level: 12 },
        { name: 'ÁŚ WesternK9', role: 'MID', hero: 'Pharsa', kda: '0/3/3', gold: 4900, level: 11 },
        { name: 'Seffyroth', role: 'GOLD', hero: 'Beatrix', kda: '4/3/1', gold: 5600, level: 12 },
        { name: 'KZO', role: 'ROAM', hero: 'Khufra', kda: '1/5/3', gold: 3400, level: 10 }
      ]
    },
    mvp: {
      player: 'blue.1',
      name: 'flins',
      role: 'JUNGLE',
      hero: 'Fanny',
      kda: '6/0/4',
      gpm: '809',
      kp: '83%'
    }
  };

  const { patch: appliedPatch, report } = PlayoffResults.prepareResult(state, patch, { source: 'scoreboard-ocr' });

  // Player names should be resolved cleanly, stripping squad abbreviations
  assert.equal(appliedPatch.red.players[0].name, 'LenXer.');
  assert.equal(appliedPatch.red.players[1].name, 'Nocturne');
  assert.equal(appliedPatch.red.players[2].name, 'WesternK9');

  // Series score should increment for winner
  assert.equal(appliedPatch.blue.score, 1);
  assert.equal(appliedPatch.red.score, 0);
  assert.equal(report.status, 'applied');
  assert.equal(report.winnerTeam, 'JMES');
});
