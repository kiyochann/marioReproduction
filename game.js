/**
 * Super Mario Bros. 1-1 Complete Reproduction - Step 3 (Asset Integration)
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// -- Constants (NTSC NES Specs) --
const TILE_SIZE = 16;
const WIDTH = 256;         // 16タイル * 16px
const HEIGHT = 240;        // 15タイル * 16px (208から拡張)
const VISIBLE_HEIGHT = 240;
let OFFSET_Y = HEIGHT - (15 * TILE_SIZE); // 15タイルマップなら 0 になる
const HIDDEN_BLOCK_COL = 64; // 1-1の隠しブロックの列位置


// -- Physics Constants (Corrected Scaling for 60FPS from 144Hz) --
const ACCEL_WALK = 0.046;   // 0.008 * 5.76
const ACCEL_RUN = 0.086;    // 0.015 * 5.76
const FRICTION = 0.069;     // 0.012 * 5.76
const MAX_WALK_SPEED = 1.7; // 最高歩行速度 (0.7 * 2.4)
const MAX_RUN_SPEED = 2.4;  // 最高ダッシュ速度 (1.0 * 2.4)
const JUMP_SPEED = -3.41;   // ジャンプ初速度 (-1.42 * 2.4)
const ANIM_SPEED = 10;      // アニメーションの切り替え間隔 (25 / 2.4)
const GRAVITY = 0.46;       // 下降時の重力 (0.08 * 5.76)
const GRAVITY_ASCENT = 0.086; // 上昇時の重力 (0.015 * 5.76)
const MAX_FALL_SPEED = 4.0; // 落下の最高速度 (調整可能)

let gameFrame = 0;
let cameraX = 0;

// -- Background Decoration Settings --
const BG_DECOR_SCALE = 0.5; // 背景素材の統一倍率 (全体的に大きいため縮小)

// -- Setup Canvas Size --
canvas.width = WIDTH;
canvas.height = HEIGHT;

// -- Game States --
const STATE_TITLE = 0;
const STATE_LOADING = 1;
const STATE_PLAYING = 2;
const STATE_GAMEOVER = 3;

// -- Global Game State --
let currentGameState = STATE_TITLE;
let currentScore = 0;
let collectedCoins = 0;
let livesRemaining = 3;
let hasReachedCheckpoint = false;
let levelTimer = 400;
let timerFrameCount = 0;
let currentWorldName = "1-1";
let titleSelection = 0; // 0: 1 PLAYER, 1: 2 PLAYER
let loadingTimer = 0;
let loadingBlackFrames = 0;

// -- Audio Engine (Nes-style Chiptune Synthesis) --
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.enabled = false;
        this.buffers = {}; // Store AudioBuffer objects for Web Audio
        this.fallbacks = {}; // Store HTMLAudioElement for fallback
        this.activeBgm = null;
        this.starBgmHandle = null;
        this.bgmBeforeStar = null;
        this.useFallback = false;
        this.lastPlayTime = {}; // レートリミット管理用
        this.fallbackIndices = {}; // プール管理用
    }

    async init() {
        if (this.enabled) return;
        console.log("AudioEngine: Initializing...");
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContextClass({ latencyHint: 'interactive' });

            // マスターコンプレッサー（リミッター）の作成
            this.masterGain = this.ctx.createGain();
            this.compressor = this.ctx.createDynamicsCompressor();
            // 強力なリミッター設定 (Brick-wall Limiter)
            this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
            this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(20, this.ctx.currentTime);
            this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
            this.compressor.release.setValueAtTime(0.1, this.ctx.currentTime);

            this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.ctx.destination);

            this.enabled = true; // 早期に有効化
            console.log("AudioEngine: Initialized (Web Audio). Context State:", this.ctx.state);

            // ロードは非同期で続行
            this.loadSounds();
        } catch (e) {
            console.warn("AudioEngine: AudioContext failed, using fallback", e);
            this.useFallback = true;
            this.enabled = true;
            this.loadSoundsFallback();
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    async loadSounds() {
        const soundFiles = this.getSoundFilesList();
        const promises = Object.entries(soundFiles).map(async ([key, src]) => {
            try {
                const response = await fetch(src);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.buffers[key] = audioBuffer;

                // プールの初期化 (Web Audio時でもフォールバック用に準備)
                if (key === 'bgm') {
                    const audio = new Audio(src);
                    audio.loop = true;
                    this.fallbacks[key] = [audio];
                } else if (key === 'coin') {
                    // コインは頻繁に鳴るためプールを大きく(15個)確保
                    this.fallbacks[key] = Array.from({ length: 15 }, () => new Audio(src));
                } else {
                    this.fallbacks[key] = [new Audio(src), new Audio(src), new Audio(src)];
                }
                this.fallbackIndices[key] = 0;
            } catch (e) {
                console.warn(`AudioEngine: Fetch failed for ${key}, trying fallback Audio.`, e);
                // fetch失敗時(file://プロトコル等)でもフォールバック用Audioを試行
                // ただし、ファイル自体が存在しない場合はフォールバックを作らず、
                // play()内のフェールセーフマッピングに委ねる
                try {
                    const testAudio = new Audio(src);
                    await new Promise((resolve, reject) => {
                        testAudio.addEventListener('canplaythrough', resolve, { once: true });
                        testAudio.addEventListener('error', reject, { once: true });
                        testAudio.load();
                        // 3秒でタイムアウト
                        setTimeout(reject, 3000);
                    });
                    // ファイルが存在する場合のみプールを作成
                    if (key === 'bgm') {
                        const audio = new Audio(src);
                        audio.loop = true;
                        this.fallbacks[key] = [audio];
                    } else if (key === 'coin') {
                        this.fallbacks[key] = Array.from({ length: 15 }, () => new Audio(src));
                    } else {
                        this.fallbacks[key] = [new Audio(src), new Audio(src), new Audio(src)];
                    }
                    this.fallbackIndices[key] = 0;
                    console.log(`AudioEngine: Fallback created for ${key}`);
                } catch (e2) {
                    console.warn(`AudioEngine: File not found for ${key}, will use fail-safe mapping.`);
                }
            }
        });

        await Promise.all(promises);
        console.log("AudioEngine: Load complete. Buffers:", Object.keys(this.buffers).length, "Fallbacks:", Object.keys(this.fallbacks).length);
        if (Object.keys(this.buffers).length === 0 && !this.useFallback) {
            console.warn("AudioEngine: No buffers loaded, switching to fallback mode.");
            this.useFallback = true;
        }
    }

    loadSoundsFallback() {
        const soundFiles = this.getSoundFilesList(); // リスト定義を共通化

        for (const [key, src] of Object.entries(soundFiles)) {
            if (key === 'bgm') {
                const audio = new Audio(src);
                audio.loop = true;
                this.fallbacks[key] = [audio];
            } else if (key === 'coin') {
                // コインは頻繁に鳴るためプールを大きく(15個)確保
                this.fallbacks[key] = Array.from({ length: 15 }, () => new Audio(src));
            } else {
                this.fallbacks[key] = [new Audio(src), new Audio(src), new Audio(src)];
            }
            this.fallbackIndices[key] = 0;
            console.log(`AudioEngine: Queued ${key} (Pool Size: ${this.fallbacks[key].length})`);
        }
    }

    getSoundFilesList() {
        return {
            bgm: 'assets/sounds/bgm_overworld.mp3',
            coin: 'assets/sounds/coin.mp3',
            jump: 'assets/sounds/jump.mp3',
            jump_big: 'assets/sounds/jump_big.mp3',
            powerup: 'assets/sounds/powerup.mp3',
            up1: 'assets/sounds/1up.mp3',
            stomp: 'assets/sounds/stomp.mp3',
            kick: 'assets/sounds/kick.mp3',
            brick_break: 'assets/sounds/brick_break.mp3',
            bump: 'assets/sounds/bump.mp3',
            fireball: 'assets/sounds/fireball.mp3',
            shrink: 'assets/sounds/shrink.mp3',
            shrink_pipe: 'assets/sounds/shrink_pipe.mp3',
            pole_start: 'assets/sounds/pole_start.mp3',
            pole_loop: 'assets/sounds/pole_loop.mp3',
            pole_end: 'assets/sounds/pole_end.mp3',
            gameover: 'assets/sounds/gameover.mp3',
            stage_clear: 'assets/sounds/stage_clear.mp3',
            death: 'assets/sounds/death.mp3',
            time_warning: 'assets/sounds/time_warning.mp3',
            star: 'assets/sounds/star.mp3',
            itemspawn: 'assets/sounds/itemspawn.mp3',
            fireballHitdokan: 'assets/sounds/fireballHitdokan.mp3'
        };
    }

    play(key, options = {}) {
        if (!this.enabled) return null;
        this.resume();

        const now = Date.now();
        console.log(`AudioEngine.play("${key}") - Context State: ${this.ctx ? this.ctx.state : 'N/A'}`);

        // 音源不在時のフェールセーフ（代替マッピング）
        let targetKey = key;
        const hasBuffer = !!this.buffers[key];
        const hasFallback = this.fallbacks[key] && this.fallbacks[key].length > 0;

        if (!hasBuffer && !hasFallback) {
            console.log(`AudioEngine: Missing sound "${key}", applying fail-safe mapping...`);
            if (key === 'star') targetKey = 'bgm';
            if (key === 'itemspawn') targetKey = 'powerup';
            if (key === 'fireballHitdokan') targetKey = 'bump';

            // それでもなければ再生をスキップ
            if (!this.buffers[targetKey] && (!this.fallbacks[targetKey] || this.fallbacks[targetKey].length === 0)) {
                console.warn(`AudioEngine: Fail-safe also failed for "${key}" -> "${targetKey}"`);
                return null;
            }
        }
        const keyToPlay = targetKey;
        console.log(`AudioEngine: Playing "${keyToPlay}" (Original Request: "${key}")`);

        // 個別オフセットの取得
        const offset = options.offset !== undefined ? options.offset : (AudioEngine.OFFSETS[key] || 0);

        // 同一SEの連続再生制限 (コインは同時取得を重視して制限なし、その他は50ms)
        const limit = (key === 'coin') ? 0 : 50;
        if (limit > 0 && this.lastPlayTime[key] && now - this.lastPlayTime[key] < limit) {
            return null;
        }
        this.lastPlayTime[key] = now;

        // High-fidelity playback (Web Audio API)
        if (!this.useFallback && this.buffers[keyToPlay]) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.buffers[keyToPlay];
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = options.volume !== undefined ? options.volume : 1.0;
            source.connect(gainNode);
            // 個別のGainNodeをマスターGainに接続（コンプレッサー経由で出力）
            if (this.masterGain) {
                gainNode.connect(this.masterGain);
            } else {
                gainNode.connect(this.ctx.destination);
            }
            if (options.loop) source.loop = true;

            source.start(0, offset);
            return source;
        }

        // Fallback playback (HTML5 Audio with Pooling)
        const pool = this.fallbacks[keyToPlay];
        const idx = this.fallbackIndices[key];
        if (pool && pool.length > 0 && idx !== undefined) {
            const sound = pool[idx];
            if (!sound) return null;

            this.fallbackIndices[key] = (idx + 1) % pool.length;

            try {
                sound.pause();
                if (offset > 0.001) sound.currentTime = offset;
                sound.volume = options.volume !== undefined ? options.volume : 1.0;
                sound.play().catch(e => {
                    // Chrome等、ユーザーインタラクション制限で再生できない場合のためのエラー回避
                    if (e.name !== 'NotAllowedError') console.error(`AudioEngine: Fallback play failed for ${keyToPlay}`, e);
                });
                return sound;
            } catch (e) {
                console.warn(`AudioEngine: Error in fallback playback for ${keyToPlay}`, e);
                return null;
            }
        }
        return null;
    }

    stopSound(handle) {
        if (!handle) return;
        try {
            if (handle.stop) handle.stop();
            else if (handle.pause) handle.pause();
        } catch (e) { }
    }

    playBGM(rate = 1.0) {
        if (!this.enabled) return;
        this.stopBGM();
        this.bgmRate = rate;
        console.log(`AudioEngine: Playing BGM (rate: ${rate})...`);
        this.activeBgm = this.play('bgm', { loop: true, volume: 0.3 });
        // playbackRateを設定 (Web Audio API / HTMLAudioElement 両方対応)
        if (this.activeBgm && this.activeBgm.playbackRate !== undefined) {
            if (this.activeBgm.playbackRate && typeof this.activeBgm.playbackRate.value === 'number') {
                // Web Audio API (BufferSourceNode): playbackRate は AudioParam
                this.activeBgm.playbackRate.value = rate;
            } else {
                // HTMLAudioElement: playbackRate は直接数値
                this.activeBgm.playbackRate = rate;
            }
        }
    }

    stopBGM() {
        if (this.activeBgm) {
            try {
                if (this.activeBgm.stop) this.activeBgm.stop();
                else if (this.activeBgm.pause) {
                    this.activeBgm.pause();
                    this.activeBgm.currentTime = 0;
                }
            } catch (e) { }
            this.activeBgm = null;
        }
    }

    // 音源別の個別オフセット定義 (mp3の先頭無音カット) - 50msの大胆なカットで遅延を相殺
    static get OFFSETS() {
        return {
            jump: 0.050,
            jump_big: 0.050,
            coin: 0.045,
            stomp: 0.040,
            kick: 0.040,
            brick_break: 0.040,
            bump: 0.030,
            fireball: 0.040,
            powerup: 0.040,
            up1: 0.040,
            shrink: 0.040,
            shrink_pipe: 0.040,
            pole_start: 0.020,
            pole_loop: 0,
            pole_end: 0.020,
            stage_clear: 0.020,
            itemspawn: 0,
            fireballHitdokan: 0
        };
    }

    playJump() { this.play('jump'); }
    playJumpBig() { this.play('jump_big'); }
    playCoin() { this.play('coin', { volume: 0.2 }); }
    playPowerUp() { this.play('powerup'); }
    play1Up() { this.play('up1'); }
    playStomp() { this.play('stomp'); }
    playKick() { this.play('kick'); }
    playBrickBreak() { this.play('brick_break'); }
    playBump() { this.play('bump'); }
    playFireball() { this.play('fireball'); }
    playShrink() { this.play('shrink'); }
    playShrinkPipe() { this.play('shrink_pipe'); }
    playPoleStart() { return this.play('pole_start', { volume: 1.2 }); }
    playPoleLoop() { return this.play('pole_loop', { loop: true, volume: 1.0 }); }
    playPoleEnd() { this.play('pole_end', { volume: 1.2 }); }
    playTimeWarning() {
        // 1. BGMを停止
        this.stopBGM();
        this.stopStarBGM();

        // 2. タイムワーニング音を再生
        const handle = this.play('time_warning');

        // 3. ワーニング音終了後にテンポアップBGMを再生
        this.isTimeWarning = true;

        // Web Audio APIの場合: onendedコールバックを使用
        if (handle && handle.onended !== undefined) {
            handle.onended = () => {
                if (this.isTimeWarning) {
                    this.isTimeWarning = false;
                    this.playBGM(1.25); // テンポアップ
                }
            };
        }

        // Fallback: 約3秒後にBGMを再開 (タイムワーニング音の典型的な長さ)
        // HTMLAudioElementはonendedイベントも使えるが、フォールバックとしてタイマーも設定
        if (handle && typeof handle.addEventListener === 'function') {
            handle.addEventListener('ended', () => {
                if (this.isTimeWarning) {
                    this.isTimeWarning = false;
                    this.playBGM(1.25);
                }
            });
        } else if (!handle || handle.onended === undefined) {
            // ハンドルがない場合はタイマーでフォールバック
            setTimeout(() => {
                if (this.isTimeWarning) {
                    this.isTimeWarning = false;
                    this.playBGM(1.25);
                }
            }, 3000);
        }
    }
    playItemSpawn() { this.play('itemspawn'); }
    playFireballHit() { this.play('fireballHitdokan'); }

    playStarBGM() {
        if (this.starBgmHandle) return; // 既に再生中
        this.bgmBeforeStar = this.activeBgm;
        this.stopBGM();
        // star.mp3がない場合は元のBGMを音量上げてループ（疑似演出）
        const starVol = this.buffers['star'] ? 0.4 : 0.6;
        this.starBgmHandle = this.play('star', { loop: true, volume: starVol });
    }

    stopStarBGM() {
        if (!this.starBgmHandle) return;
        this.stopSound(this.starBgmHandle);
        this.starBgmHandle = null;
        // 元のBGMに戻す
        if (this.bgmBeforeStar) {
            this.playBGM();
            this.bgmBeforeStar = null;
        }
    }

    playDeath() {
        this.stopBGM();
        this.play('death');
    }

    playGameOver() {
        this.stopBGM();
        this.play('gameover');
    }

    playGoal() {
        this.stopBGM();
        this.play('stage_clear');
    }

    playPowerUpSpawn() {
        this.playTone(400, 'square', 0.5, 0.05, 800);
    }

    playCountDown() {
        // スピード感のあるスコア清算音 (短く高い「ピッ」)
        this.playTone(1200, 'square', 0.08, 0.4); // さらに大きく長くして確実に聞こえるように
    }

    // legacy method for synthesized sounds
    playTone(freq, type, duration, volume = 0.1, slide = 0) {
        if (!this.enabled || !this.ctx) return;
        this.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        if (slide !== 0) {
            osc.frequency.exponentialRampToValueAtTime(slide, this.ctx.currentTime + duration);
        }

        gain.gain.setValueAtTime(volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
}

const audioEngine = new AudioEngine();

// ユーザー操作でオーディオを有効化
window.addEventListener('mousedown', async () => {
    await audioEngine.init();
    if (currentGameState === STATE_PLAYING) audioEngine.playBGM();
}, { once: true });
window.addEventListener('keydown', async () => {
    await audioEngine.init();
    if (currentGameState === STATE_PLAYING) audioEngine.playBGM();
}, { once: true });

function updateGameSystem() {
    if (currentGameState === STATE_GAMEOVER || mario.isDead) return;

    // タイマー減衰 (原作準拠: 約0.4秒 = 24フレームごとに1カウント)
    timerFrameCount++;
    if (timerFrameCount >= 24) {
        timerFrameCount = 0;
        if (levelTimer > 0) {
            levelTimer--;
            if (levelTimer === 100) {
                audioEngine.playTimeWarning();
            }
            if (levelTimer === 0) {
                window.isTimeUp = true;
                mario.die(); // タイムアップ
            }
        }
    }
}

function drawHUD(ctx) {

    ctx.fillStyle = "white";
    ctx.font = "8px 'Courier New', monospace"; // シンプルなドット風フォント
    ctx.textBaseline = "top";

    const pad = (num, size) => num.toString().padStart(size, '0');

    // 1行目: ラベル
    drawText(ctx, "MARIO", 24, 12);
    drawText(ctx, "WORLD", 144, 12);
    drawText(ctx, "TIME", 200, 12);

    // 2行目: 値
    drawText(ctx, pad(currentScore, 6), 24, 20);

    // コイン表示 (アイコン + × + 枚数)
    // 段階的に変化させる順序 [明るい(0), 普通(1), 暗い(2), 普通(1)]
    // 一番明るい状態(0)を長く維持するように調整
    const coinSequence = [0, 0, 0, 1, 2, 1];
    const sequenceIndex = Math.floor(gameFrame / 12) % coinSequence.length;
    const coinAsset = assets.uiCoin[coinSequence[sequenceIndex]];
    if (coinAsset && coinAsset.image.complete) {
        const imgW = coinAsset.image.naturalWidth || coinAsset.image.width;
        const imgH = coinAsset.image.naturalHeight || coinAsset.image.height;

        // サイズを少し大きく (8.5px) しつつ、バランスを調整
        const scaleH = Math.min(8.5 / imgH, 1);
        const drawH = Math.round(imgH * scaleH);
        const drawW = Math.round(imgW * scaleH * 1.25);

        // 領域内（10px高の領域で中央寄せ）
        const offX = Math.floor((10 - drawW) / 2);
        const offY = Math.floor((10 - drawH) / 2);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(coinAsset.image, 87 + offX, 18 + offY, drawW, drawH);
        ctx.imageSmoothingEnabled = false;
    } else {
        ctx.beginPath();
        ctx.fillStyle = "yellow";
        ctx.arc(104, 24, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // × (X) を個別に小さく描画してバランスを取る
    const xAsset = assets.font['X'];
    if (xAsset && xAsset.image.complete) {
        // Xを少し大きく (6px程度)
        const targetXSize = 6;
        const imgW = xAsset.image.width;
        const imgH = xAsset.image.height;
        const scale = Math.min(targetXSize / imgW, targetXSize / imgH, 1);
        const drawW = Math.round(imgW * scale);
        const drawH = Math.round(imgH * scale);

        // 8x8の領域の中 (x=110)
        const offX = Math.floor((8 - drawW) / 2);
        const offY = Math.floor((8 - drawH) / 2);

        ctx.imageSmoothingEnabled = true;
        // 左に 1px 移動 (97 -> 96), 1px 上に移動 (20 -> 19)
        ctx.drawImage(xAsset.image, 96 + offX, 19 + offY, drawW, drawH);
        ctx.imageSmoothingEnabled = false;
    }

    // 数字は y=20 (107 -> 106)
    drawText(ctx, pad(collectedCoins, 2), 106, 20);

    drawText(ctx, currentWorldName, 152, 20);
    // タイトル画面では残り時間は表示しない
    if (currentGameState !== STATE_TITLE) {
        drawText(ctx, pad(levelTimer, 3), 200, 20);
    }

    if (currentGameState === STATE_GAMEOVER) {
        if (window.isTimeUp && (!window.gameOverTimer || window.gameOverTimer < 180)) {
            drawText(ctx, "TIME UP", WIDTH / 2 - 28, HEIGHT / 2 - 8);
        } else {
            drawText(ctx, "GAME OVER", WIDTH / 2 - 36, HEIGHT / 2 - 8);
        }
    }
}

// -- Text Rendering --
function drawText(ctx, text, x, y, scaleX = 1.0, scaleY = 1.0) {
    const uppercaseText = text.toUpperCase();
    let currentX = x;
    const baseSpacing = 8 * scaleX;

    for (let i = 0; i < uppercaseText.length; i++) {
        const char = uppercaseText[i];
        if (char === ' ') {
            currentX += baseSpacing;
            continue;
        }
        const fontAsset = assets.font[char];
        if (fontAsset && fontAsset.image.complete && fontAsset.image.width > 0) {
            const boxW = 8 * scaleX;
            const boxH = 8 * scaleY;
            const imgW = fontAsset.image.width;
            const imgH = fontAsset.image.height;

            if (imgW > 0 && imgH > 0) {
                const internalScale = Math.min(7 / imgW, 7 / imgH, 1);
                const drawW = Math.max(1, Math.round(imgW * internalScale * scaleX));
                const drawH = Math.max(1, Math.round(imgH * internalScale * scaleY));

                const offsetX = Math.floor((boxW - drawW) / 2);
                const offsetY = Math.floor((boxH - drawH) / 2);

                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(fontAsset.image, Math.floor(currentX) + offsetX, Math.floor(y) + offsetY, drawW, drawH);
                ctx.imageSmoothingEnabled = false;
            }
            currentX += baseSpacing;
        } else {
            currentX += baseSpacing;
        }
    }
}

function drawWorld(ctx) {
    // 1. 背景描画
    ctx.fillStyle = currentWorld.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const startCol = Math.floor(cameraX / TILE_SIZE);
    const endCol = startCol + Math.ceil(WIDTH / TILE_SIZE);

    // -- 背景装飾の描画 --
    if (currentWorld.bgDecor) {
        for (let y = 0; y < currentWorld.bgDecor.length; y++) {
            let bgStartCol = startCol - 10;
            for (let x = bgStartCol; x <= endCol; x++) {
                if (x < 0 || x >= currentWorld.bgDecor[y].length) continue;
                const char = currentWorld.bgDecor[y][x];
                if (char === ' ') continue;

                const decorAsset = assets.bgDecor[char];
                if (decorAsset && decorAsset.image.complete) {
                    const img = decorAsset.image;
                    const rx = Math.round(x * TILE_SIZE - cameraX);
                    let ry = Math.round(y * TILE_SIZE + OFFSET_Y);

                    // 統一倍率を適用
                    const dw = img.naturalWidth * BG_DECOR_SCALE;
                    const dh = img.naturalHeight * BG_DECOR_SCALE;

                    // 山や草 ('m', 'M', 'g', 'G', 't') はタイルの「下端」を基準に描画し、上に伸ばす
                    if (['m', 'M', 'g', 'G', 't'].includes(char)) {
                        ry += (TILE_SIZE - dh);
                    }

                    // 統一した倍率で描画
                    ctx.drawImage(img, rx, ry, dw, dh);
                }
            }
        }
    }

    // 3. お城の描画 (1-1 のゴール地点以降)
    if (currentWorld.id === '1-1') {
        const castleAsset = assets.goal.castle;
        if (castleAsset && castleAsset.image.complete) {
            const img = castleAsset.image;
            // ポール(198)の少し先、202列目あたりに配置
            const castleColumn = 202;
            const rx = Math.round(castleColumn * TILE_SIZE - cameraX);

            // 地面に設置するようにY座標を調整 (下端をGroundの高さに合わせる)
            // 1-1の地面の高さは Row 14
            const scale = 0.5;
            const dw = img.naturalWidth * scale;
            const dh = img.naturalHeight * scale * 1.1;
            const ry = Math.round(14 * TILE_SIZE + OFFSET_Y - dh);

            // 2. 城の旗の描画 (城本体の前に描画することで背後に回す)
            const flagAsset = assets.goal.castleFlag;
            if (flagAsset && flagAsset.image.complete && mario.castleFlagY > 0) {
                const fimg = flagAsset.image;
                const fscale = 0.5;
                const fdw = fimg.naturalWidth * fscale;
                const fdh = fimg.naturalHeight * fscale;

                // 城の中心の上端あたりから出現
                const frx = rx + (dw - fdw) / 2;
                const fry = ry - mario.castleFlagY;

                ctx.drawImage(fimg, frx, fry, fdw, fdh);
            }

            // 3. 城本体の描画
            ctx.drawImage(img, rx, ry, dw, dh);
        }
    }

    // 4. マップ描画 (背景レイヤー: 土管以外)

    for (let y = 0; y < currentWorld.map.length; y++) {
        for (let x = startCol; x <= endCol; x++) {
            if (x < 0 || x >= currentWorld.map[y].length) continue;
            let char = currentWorld.map[y][x];
            if (char === ' ') continue;

            // 土管は前面レイヤーで描画するためスキップ
            if (['[', ']', '{', '}', 'h', 'i', 'j', 'k', 'l', 'm'].includes(char)) continue;

            // 地下タイルの置換
            if (currentWorld.isUnderground && UNDER_TILE_MAP[char]) {
                char = UNDER_TILE_MAP[char];
            }

            const bumpState = blockStates[getBlockKey(x, y)];
            const bumpOffset = bumpState ? bumpState.bumpY : 0;
            drawTile(ctx, char, x * TILE_SIZE - cameraX, y * TILE_SIZE + OFFSET_Y + bumpOffset, x, y);
        }
    }

    // 5. 前面描画レイヤー (土管など)
    for (let y = 0; y < currentWorld.map.length; y++) {
        for (let x = startCol; x <= endCol; x++) {
            if (x < 0 || x >= currentWorld.map[y].length) continue;
            let char = currentWorld.map[y][x];
            if (['[', ']', '{', '}', 'h', 'i', 'j', 'k', 'l', 'm'].includes(char)) {
                drawTile(ctx, char, x * TILE_SIZE - cameraX, y * TILE_SIZE + OFFSET_Y, x, y);
            }
        }
    }
}

function drawTitleScreen(ctx) {
    if (gameFrame % 60 === 0) {
        console.log("Rendering Title Screen... currentGameState:", currentGameState);
    }

    // 1. ゲーム画面を背景として描画
    drawWorld(ctx);

    // 2. マリオを描画 (追加)
    mario.draw(ctx);


    // 3. タイトルロゴ描画 (真ん中上, 縮小)
    if (assets.title.image.complete && assets.title.image.width > 0) {
        const img = assets.title.image;
        const targetWidth = 176;
        const scale = targetWidth / img.width;

        // 整数値に丸めることで、サブピクセルレンダリングによる「線が消える」現象を防ぐ
        const logoW = Math.round(img.width * scale);
        const logoH = Math.round(img.height * scale);
        const logoX = Math.round((WIDTH - logoW) / 2);
        const logoY = 28;

        ctx.drawImage(img, logoX, logoY, logoW, logoH);
    } else {
        // フォールバック: テキストでタイトル表示
        drawText(ctx, "SUPER MARIO BROS.", 62, 40);
        if (gameFrame % 60 === 0) console.warn("Title image not ready or failed.");
    }

    // 4. 選択肢表示
    drawText(ctx, "1 PLAYER GAME", 80, 144);
    drawText(ctx, "2 PLAYER GAME", 80, 160);

    // 5. きのこカーソル表示
    if (assets.cursor.image.complete && assets.cursor.image.width > 0) {
        // カーソルが「1 PLAYER GAME」などのテキストの左に表示される
        // 少し小さく(例えば最大14px)、かつ元画像のアスペクト比を維持してシンメトリに保つ
        const imgW = assets.cursor.image.naturalWidth;
        const imgH = assets.cursor.image.naturalHeight;
        const scale = Math.min(14 / imgW, 14 / imgH, 1);
        const drawW = Math.max(1, Math.round(imgW * scale));
        const drawH = Math.max(1, Math.round(imgH * scale));

        // 中心を合わせる(元々16x16の領域(58, cursorY)から開始していたので、真ん中(16-draw)/2を足す)
        const offsetX = Math.floor((16 - drawW) / 2);
        const offsetY = Math.floor((16 - drawH) / 2);

        const cursorY = titleSelection === 0 ? 140 : 156;

        // 小数倍の縮小でピクセルが非対称に欠けるのを防ぐため、一時的にスムージングを有効化
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(assets.cursor.image, 58 + offsetX, cursorY + offsetY, drawW, drawH);
        ctx.imageSmoothingEnabled = false;
    } else if (gameFrame % 60 === 0) {
        console.warn("Cursor image not ready or failed.");
    }
}

function drawLoadingScreen(ctx) {
    // 1. 真っ黒な背景
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 2. WORLD 1-1
    drawText(ctx, `WORLD ${currentWorldName}`, 88, 80);

    // 3. マリオアイコンと残機数
    // マリオのニュートラル画像を使用 (16x16)
    if (assets.mario.neutral.image.complete) {
        ctx.drawImage(assets.mario.neutral.image, 96, 104, 16, 16);
    }
    drawText(ctx, `X  ${livesRemaining}`, 120, 108);
}

function disableSmoothing(c) {
    c.imageSmoothingEnabled = false;
    c.mozImageSmoothingEnabled = false;
    c.webkitImageSmoothingEnabled = false;
    c.msImageSmoothingEnabled = false;
}
disableSmoothing(ctx);

// -- Tile Cache (オフスクリーンレンダリング用) --
const tileCache = {};

// -- RAII的 Canvas Context ヘルパー --
// ctx.save()/restore()の確実なペアリングを保証し、例外発生時でも状態が復元される
function withContext(ctx, fn) {
    ctx.save();
    try {
        fn(ctx);
    } finally {
        ctx.restore();
    }
}

function getCachedTile(id, renderFn) {
    if (tileCache[id]) return tileCache[id];
    const offscreen = document.createElement('canvas');
    offscreen.width = TILE_SIZE;
    offscreen.height = TILE_SIZE;
    const offCtx = offscreen.getContext('2d');
    // 重要: 高解像度画像をスケーリングする際のぼやけを防ぐ
    disableSmoothing(offCtx);
    renderFn(offCtx);
    tileCache[id] = offscreen;
    return offscreen;
}

// 画像キャッシュバスティング (フォント等を編集した際に必ず新しい画像を読み込む)
const ASSET_TS = Date.now();

// -- Assets & Loading --
const assets = {
    tiles: {
        'G': { src: 'assets/block/brock4_ground.png', image: new Image() },
        '#': { src: 'assets/block/brock2_renga.png', image: new Image() },
        'O': { src: 'assets/block/brock1_object.png', image: new Image() },
        '?': { src: 'assets/block/block3(hatena).jpg', image: new Image() },
        'U': { src: 'assets/block/block4(hatena2).png', image: new Image() }, // 使用済みブロックにも同じ画像を使用
        'F': { src: 'assets/block/block_4(ground_2).png', image: new Image() }, // ゴール用（暫定）
        'M': { src: 'assets/block/block3(hatena).jpg', image: new Image() }, // アイテム（キノコ/フラワー）用ハテナブロック
        'C': { src: 'assets/block/brock2_renga.png', image: new Image() }, // 連続コインブロック
        'S': { src: 'assets/block/brock2_renga.png', image: new Image() }, // スター用ハテナブロック (見た目はレンガ)
    },
    mario: {
        neutral: { src: 'assets/mario/mario_1(neutral).png', image: new Image() },
        dash1: { src: 'assets/mario/mario_2(dash_1).png', image: new Image() },
        dash2: { src: 'assets/mario/mario_3(dash_2).png', image: new Image() },
        dash3: { src: 'assets/mario/mario_4(dash_3).png', image: new Image() },
        jump: { src: 'assets/mario/mario_5(jump_1).png', image: new Image() },
        turn: { src: 'assets/mario/mario_6(turn_1).png', image: new Image() },
        sliding: { src: 'assets/mario/mario8_goal.png', image: new Image() },
        gameover: { src: 'assets/mario/mario_7(gameover_1).png', image: new Image() },
    },
    superMario: {
        neutral: { src: 'assets/smario/smario_1(neutral).png', image: new Image() },
        dash1: { src: 'assets/smario/smario_2(dash_1).png', image: new Image() },
        dash2: { src: 'assets/smario/smario_3(dash_2).png', image: new Image() },
        dash3: { src: 'assets/smario/smario_2(dash_1).png', image: new Image() },
        jump: { src: 'assets/smario/smario_4(jump_1).png', image: new Image() },
        turn: { src: 'assets/smario/smario_5(turn_1).png', image: new Image() },
        sliding: { src: 'assets/smario/smario8_goal.png', image: new Image() },
        duck: { src: 'assets/smario/smario_7(duck).png', image: new Image() },
        gameover: { src: 'assets/smario/smario_6(gameover_1).png', image: new Image() },
    },
    fireMario: {
        neutral: { src: 'assets/firemario/fsMario1(neutral).png', image: new Image() },
        dash1: { src: 'assets/firemario/fsMario3(dash).png', image: new Image() },
        dash2: { src: 'assets/firemario/fsMario4(dash).png', image: new Image() },
        dash3: { src: 'assets/firemario/fsMario5(dash).png', image: new Image() },
        jump: { src: 'assets/firemario/fsMario6(jump).png', image: new Image() },
        turn: { src: 'assets/firemario/fsMario2(turn).png', image: new Image() },
        sliding: { src: 'assets/firemario/fsMario8(goal).png', image: new Image() },
        duck: { src: 'assets/firemario/fsMario7(down).png', image: new Image() },
        gameover: { src: 'assets/firemario/fsMario7(down).png', image: new Image() },
    },
    tilesExtra: {
        '[': { src: 'assets/pipe/dokan.png', image: new Image() },
        ']': { src: 'assets/pipe/dokan.png', image: new Image() },
        '{': { src: 'assets/pipe/under/dokan(under)_vertical_left.png', image: new Image() },
        '}': { src: 'assets/pipe/under/dokan(under)_vertical_right.png', image: new Image() },
        'B': { src: 'assets/block/brock2_renga.png', image: new Image() },
        'extra_u': { src: 'assets/tiles_under/brock(under)1.png', image: new Image() },
        'extra_b': { src: 'assets/tiles_under/brock(under)2.png', image: new Image() },
        'extra_g': { src: 'assets/tiles_under/brock(under)3.png', image: new Image() },
        'p_u': { src: 'assets/pipe/dokan_tugi.png', image: new Image() },
        'p_h': { src: 'assets/pipe/dokan_under.png', image: new Image() },
        'h': { src: 'assets/pipe/under/dokan(under)_left_up.png', image: new Image() },
        'j': { src: 'assets/pipe/under/dokan(under)_center_up.png', image: new Image() },
        'k': { src: 'assets/pipe/under/dokan(under)_right_up.png', image: new Image() },
        'i': { src: 'assets/pipe/under/dokan(under)_left_down.png', image: new Image() },
        'l': { src: 'assets/pipe/under/dokan(under)_center_down.png', image: new Image() },
        'm': { src: 'assets/pipe/under/dokan(under)_right_down.png', image: new Image() },
        'p_v_l': { src: 'assets/pipe/dokan_under_v_l.png', image: new Image() },
        'p_v_r': { src: 'assets/pipe/dokan_under_v_r.png', image: new Image() },
    },
    fireball: {
        sprite: { src: 'assets/fireball/fireball.png', image: new Image() },
        hits: [
            { src: 'assets/fireball/fireballhiteffect1.png', image: new Image() },
            { src: 'assets/fireball/fireballhiteffect2.png', image: new Image() },
            { src: 'assets/fireball/fireballhiteffect3.png', image: new Image() }
        ]
    },
    enemies: {
        goomba1: { src: 'assets/enemy/kuribo1.png', image: new Image() },
        goomba2: { src: 'assets/enemy/kuribo2.png', image: new Image() },
        koopa1: { src: 'assets/enemy/kame1.png', image: new Image() },
        koopa2: { src: 'assets/enemy/kame2.png', image: new Image() },
        koopaShell: { src: 'assets/enemy/kame5.png', image: new Image() },      // 足なし甲羅（通常）
        koopaShellLegs: { src: 'assets/enemy/kame4.png', image: new Image() },  // 足あり甲羅（復活直前の点滅用）
    },
    items: {
        mushroom: { src: 'assets/items/skinoko.png', image: new Image() },
        oneUpMushroom: { src: 'assets/items/1upkinoko.png', image: new Image() },
        fireFlower: [
            { src: 'assets/items/flower/fireflower1.png', image: new Image() },
            { src: 'assets/items/flower/fireflower2.png', image: new Image() },
            { src: 'assets/items/flower/fireflower3.png', image: new Image() },
            { src: 'assets/items/flower/fireflower4.png', image: new Image() }
        ],
        star: [
            { src: 'assets/items/star/star1.png', image: new Image() },
            { src: 'assets/items/star/star2.png', image: new Image() },
            { src: 'assets/items/star/star3.png', image: new Image() },
            { src: 'assets/items/star/star4.png', image: new Image() }
        ],
        underCoin1: { src: 'assets/coin/under/coin1.png', image: new Image() },
        underCoin2: { src: 'assets/coin/under/coin2.png', image: new Image() },
        underCoin3: { src: 'assets/coin/under/coin3.png', image: new Image() }
    },
    coin: { src: 'assets/coin/coin.png', image: new Image() },
    breakEffect: { src: 'assets/block/broken_effect.png', image: new Image() },
    title: { src: `assets/title/title.png?t=${ASSET_TS}`, image: new Image() },
    logo: { src: `assets/title/titlelogo.png?t=${ASSET_TS}`, image: new Image() },
    goal: {
        pole: { src: 'assets/goal/goalpoll.png', image: new Image() },
        flag: { src: 'assets/goal/goalflag.png', image: new Image() },
        castle: { src: 'assets/background/castle.png', image: new Image() },
        castleFlag: { src: 'assets/background/castleFlag.png', image: new Image() }
    },
    cursor: { src: `assets/title/Cursor.png?t=${ASSET_TS}`, image: new Image() },
    bgDecor: {
        'c': { src: 'assets/background/cloud1.png', image: new Image() },
        'C': { src: 'assets/background/cloud2.png', image: new Image() },
        'v': { src: 'assets/background/cloud3.png', image: new Image() },
        'g': { src: 'assets/background/grass1.png', image: new Image() },
        'G': { src: 'assets/background/grass2.png', image: new Image() },
        't': { src: 'assets/background/grass3.png', image: new Image() },
        'm': { src: 'assets/background/mountain1.png', image: new Image() },
        'M': { src: 'assets/background/mountain2.png', image: new Image() }
    },
    font: {}, // 文字列キー: { image, src }
    uiCoin: [
        { src: 'assets/ui/coin/uicoin1.png', image: new Image() },
        { src: 'assets/ui/coin/uicoin2.png', image: new Image() },
        { src: 'assets/ui/coin/uicoin3.png', image: new Image() }
    ],
    hatena: [
        { src: 'assets/block/block3(hatena).jpg', image: new Image() },
        { src: 'assets/block/block3(hatena).jpg', image: new Image() },
        { src: 'assets/block/block3(hatena).jpg', image: new Image() }
    ],
    getedCoin: [
        { src: 'assets/coin/getedcoin1.png', image: new Image() },
        { src: 'assets/coin/getedcoin2.png', image: new Image() },
        { src: 'assets/coin/getedcoin3.png', image: new Image() },
        { src: 'assets/coin/getedcoin4.png', image: new Image() }
    ]
};

// 画像キャッシュバスティング (フォント等を編集した際に必ず新しい画像を読み込む)


const FONT_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-";
for (const char of FONT_CHARS) {
    let filenameChar = char;
    if (char === '-') filenameChar = '-';

    assets.font[char] = {
        src: `assets/font/marioFont_${filenameChar}.png?t=${ASSET_TS}`,
        image: new Image()
    };
}
assets.font[' '] = null; // スペース用

function loadAssets() {
    console.log("Loading assets...");
    const promises = [];

    const load = (img, src) => {
        return new Promise(resolve => {
            img.onload = () => {
                console.log("Loaded: " + src);
                resolve();
            };
            img.onerror = () => {
                console.error("Failed to load: " + src);
                resolve(); // エラーでも続行
            };
            if (src) img.src = src;
            else resolve();
        });
    };

    // Tiles
    [assets.tiles, assets.tilesExtra].forEach(group => {
        for (const key in group) {
            promises.push(load(group[key].image, group[key].src));
        }
    });

    // Mario
    ['mario', 'superMario', 'fireMario'].forEach(actor => {
        for (const key in assets[actor]) {
            promises.push(load(assets[actor][key].image, assets[actor][key].src));
        }
    });

    // Enemies
    for (const key in assets.enemies) {
        promises.push(load(assets.enemies[key].image, assets.enemies[key].src));
    }

    // Items
    for (const key in assets.items) {
        const item = assets.items[key];
        if (Array.isArray(item)) {
            item.forEach(f => promises.push(load(f.image, f.src)));
        } else {
            promises.push(load(item.image, item.src));
        }
    }

    // Fireball
    promises.push(load(assets.fireball.sprite.image, assets.fireball.sprite.src));
    assets.fireball.hits.forEach(hit => promises.push(load(hit.image, hit.src)));

    // Singles
    ['coin', 'breakEffect', 'title', 'cursor'].forEach(key => {
        if (assets[key]) promises.push(load(assets[key].image, assets[key].src));
    });

    // Arrays (Hatena, getedCoin, uiCoin) - 存在する場合のみ
    ['hatena', 'getedCoin', 'uiCoin'].forEach(key => {
        if (Array.isArray(assets[key])) {
            assets[key].forEach(item => promises.push(load(item.image, item.src)));
        }
    });

    // Goal
    for (const key in assets.goal) {
        promises.push(load(assets.goal[key].image, assets.goal[key].src));
    }

    // Note: p_v_lu, p_v_ld, p_v_ru, p_v_rd は tilesExtra のイテレーションで既にロード済み

    // Background Decorations
    for (const key in assets.bgDecor) {
        promises.push(load(assets.bgDecor[key].image, assets.bgDecor[key].src));
    }

    // Fonts
    for (const char in assets.font) {
        if (assets.font[char]) {
            promises.push(load(assets.font[char].image, assets.font[char].src));
        }
    }

    return Promise.all(promises);
}

// (Redundant Input Handling removed, now handled before the loop)

function buildTileCaches() {
    console.log("Building tile caches...");
    // キャッシュを完全にクリアする
    for (const key in tileCache) delete tileCache[key];

    // 通常ブロック（暗め）のキャッシュ
    for (const id of ['G', '#', 'B', 'O', 'S', 'C']) {
        const tile = assets.tiles[id] || assets.tilesExtra[id];
        if (tile && tile.image.complete) {
            getCachedTile('dark_' + id, (offCtx) => {
                // 真ん中の線が消えないように考慮して描画
                const nw = tile.image.naturalWidth || TILE_SIZE;
                const nh = tile.image.naturalHeight || TILE_SIZE;
                const sw = Math.floor(nw / 16) * 16;
                const sh = Math.floor(nh / 16) * 16;
                offCtx.drawImage(tile.image, 0, 0, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);
                offCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                offCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
            });
        }
    }

    // 地下専用ブロックのキャッシュ (extra_g, extra_u, extra_b)
    for (const id of ['extra_g', 'extra_u', 'extra_b']) {
        const tile = assets.tilesExtra[id];
        if (tile && tile.image.complete && tile.image.naturalWidth !== 0) {
            getCachedTile(id, (offCtx) => {
                const nw = tile.image.naturalWidth;
                const nh = tile.image.naturalHeight;
                const sw = Math.floor(nw / 16) * 16;
                const sh = Math.floor(nh / 16) * 16;
                offCtx.drawImage(tile.image, 0, 0, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);
            });
        }
    }

    // 土管タイルのキャッシュ (地上)
    const pipeIds = ['[', ']', '{', '}'];
    for (const id of pipeIds) {
        const isLeft = (id === '[' || id === '{');
        const isHead = (id === '[' || id === ']');
        getCachedTile('pipe_' + id, (offCtx) => {
            const img = assets.tilesExtra['['].image;
            if (img.complete && img.naturalWidth > 0) {
                const sw = img.naturalWidth / 2;
                const sh = img.naturalHeight / 2;
                const sx = isLeft ? 0 : sw;
                const sy = isHead ? 0 : sh;
                offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);
            }
        });
    }

    // 地下垂直土管タイルのキャッシュ
    for (const id of pipeIds) {
        const isLeft = (id === '[' || id === '{');
        getCachedTile('pipe_u_' + id, (offCtx) => {
            if (id === '{' || id === '}') {
                const img = assets.tilesExtra[id].image;
                if (img && img.complete && img.naturalWidth > 0) {
                    offCtx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
                }
            } else {
                const key = isLeft ? 'p_v_l' : 'p_v_r';
                const img = assets.tilesExtra[key].image;
                if (img && img.complete && img.naturalWidth > 0) {
                    offCtx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
                }
            }
        });
    }

    // 地下横土管のキャッシュ (3x2タイル)
    for (const id of ['h', 'i', 'j', 'k', 'l', 'm']) {
        getCachedTile('pipe_u_' + id, (offCtx) => {
            const tile = assets.tilesExtra[id];
            if (tile && tile.image && tile.image.complete && tile.image.naturalWidth > 0) {
                // If specific image is specified, use it directly
                offCtx.drawImage(tile.image, 0, 0, TILE_SIZE, TILE_SIZE);
            } else {
                const img = assets.tilesExtra['p_h'].image;
                if (img && img.complete && img.naturalWidth > 0) {
                    const cols = 3;
                    const rows = 2;
                    const sw = img.naturalWidth / cols;
                    const sh = img.naturalHeight / rows;
                    const mapCol = (id === 'h' || id === 'k') ? 0 : ((id === 'i' || id === 'l') ? 1 : 2);
                    const mapRow = (id === 'h' || id === 'i' || id === 'j') ? 0 : 1;
                    offCtx.drawImage(img, mapCol * sw, mapRow * sh, sw, sh, 0, 0, TILE_SIZE, TILE_SIZE);
                }
            }
        });
    }
}

function drawTile(ctx, id, x, y, tx, ty) {
    const rx = Math.round(x);
    const ry = Math.round(y);

    // 使用済みブロック (U): hatena2の画像を描画
    if (id === 'U') {
        const tile = assets.tiles['U'];
        if (tile && tile.image.complete) {
            ctx.drawImage(tile.image, rx, ry, TILE_SIZE, TILE_SIZE);
        } else {
            // 画像が読み込めていない時のフォールバック
            ctx.fillStyle = '#8B7355';
            ctx.fillRect(rx, ry, TILE_SIZE, TILE_SIZE);
        }
        return;
    }

    // はてなブロック (通常?, パワーアップM): アニメーション
    if (id === '?' || id === 'M') {
        const animStep = Math.floor(gameFrame / ANIM_SPEED) % 5;
        const tile = assets.tiles['?'];
        if (tile && tile.image.complete) {
            ctx.drawImage(tile.image, rx, ry, TILE_SIZE, TILE_SIZE);
            if (animStep === 3) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.fillRect(rx, ry, TILE_SIZE, TILE_SIZE);
            } else if (animStep === 2 || animStep === 4) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fillRect(rx, ry, TILE_SIZE, TILE_SIZE);
            }
        }
        return;
    }

    // 土管 (通常): キャッシュから描画
    if (['[', ']', '{', '}'].includes(id)) {
        const prefix = currentWorld.isUnderground ? 'pipe_u_' : 'pipe_';
        const cached = tileCache[prefix + id];
        if (cached) {
            ctx.drawImage(cached, rx, ry);
        }
        return;
    }

    // 地下横土管: 縦横比を維持してアライメントを調整し直接描画
    if (['h', 'i', 'j', 'k', 'l', 'm'].includes(id)) {
        const tile = assets.tilesExtra[id];
        if (tile && tile.image.complete && tile.image.naturalWidth > 0) {
            const scale = 0.5; // 元画像幅に対して一律0.5倍
            const drawW = Math.max(1, Math.round(tile.image.naturalWidth * scale));
            const drawH = Math.max(1, Math.round(tile.image.naturalHeight * scale));
            let rxOffset = 0;
            // 左側パーツ (h, i) は右端を隣のセンターパーツにぴったり合わせるため、はみ出し分を左に逃がす
            if (id === 'h' || id === 'i') {
                rxOffset = TILE_SIZE - drawW;
            }

            // 下側のパーツ (i, l, m) を右に1pxずらす
            if (id === 'i' || id === 'l' || id === 'm') {
                rxOffset += 1;
            }

            ctx.drawImage(tile.image, rx + rxOffset, ry, drawW, drawH);
        } else {
            // フォールバック: キャッシュを使用
            const cached = tileCache['pipe_u_' + id];
            if (cached) ctx.drawImage(cached, rx, ry);
        }
        return;
    }

    // ゴール旗: キャッシュからではなく、全体を一度に描画する
    if (id === 'F') {
        // 上に 'F' がある場合は、上端のタイルですでに描画されているのでスキップ
        // tx, ty (タイル座標) を使って判定することで、カメラが動いても正確に判定できる
        const tileAbove = getTileAt(tx * TILE_SIZE, (ty - 1) * TILE_SIZE);
        if (tileAbove === 'F') return;

        // ポールの全高を計算
        let poleLength = 1;
        while (getTileAt(tx * TILE_SIZE, (ty + poleLength) * TILE_SIZE) === 'F') {
            poleLength++;
        }

        // 1. ポール本体の描画
        const poleImg = assets.goal.pole.image;
        if (poleImg.complete && poleImg.naturalWidth > 0) {
            // 幅は TILE_SIZE (16px) に固定し、高さはブロック数分にスケーリング
            // これにより、ポールの画像が 16x16 に潰されるのを防ぐ
            ctx.drawImage(poleImg, rx, ry, TILE_SIZE, poleLength * TILE_SIZE);
        }

        // 2. 旗の描画
        const flagImg = assets.goal.flag.image;
        if (flagImg.complete && flagImg.naturalWidth > 0) {
            // デフォルトの高さ (ポールの先端: ry)
            // ポールの上の丸い部分にかぶらないように 10px 下から開始する
            let flagDrawY = ry + 10;

            if (mario.isGoalSequence) {
                flagDrawY += mario.goalFlagY;
                // 土台（ポールの足元）にめり込まないように制限
                // ポールの全高 (poleLength * TILE_SIZE) から旗の高さ(16px)と土台(16px)を引いた位置
                flagDrawY = Math.min(flagDrawY, ry + (poleLength - 1) * TILE_SIZE - 16);
            }

            // 旗はポールの左側に配置 (16x16)
            // ポールの「棒」の部分に密着するように x 座標を調整
            // ポールの中心は rx + 8px なので、16pxの旗の右端を 8px に合わせる (rx + 8 - 16 = rx - 8)
            ctx.drawImage(flagImg, rx - 8, flagDrawY, 16, 16);
        }
        return;
    }

    // 隠しブロック (I): 叩かれるまで描画しない
    if (id === 'I') {
        return;
    }

    // 通常ブロック: キャッシュから描画（暗めのタイル）
    const darkCached = tileCache['dark_' + id];
    if (darkCached) {
        ctx.drawImage(darkCached, rx, ry);
        return;
    }

    // 地下専用ブロック (extra_g, extra_u, extra_b)
    if (id === 'extra_g' || id === 'extra_u' || id === 'extra_b') {
        const cached = tileCache[id];
        if (cached) {
            ctx.drawImage(cached, rx, ry);
        } else {
            const tile = assets.tilesExtra[id];
            if (tile && tile.image.complete) {
                // 地下タイルは精密な描画を維持 (以前の修正を継承)
                const nw = tile.image.naturalWidth || TILE_SIZE;
                const nh = tile.image.naturalHeight || TILE_SIZE;
                const sw = Math.floor(nw / 16) * 16;
                const sh = Math.floor(nh / 16) * 16;
                ctx.drawImage(tile.image, 0, 0, sw, sh, rx, ry, TILE_SIZE, TILE_SIZE);
            }
        }
        return;
    }

    // キャッシュにない場合はそのまま描画 (標準描画に戻す)
    const tile = assets.tiles[id] || assets.tilesExtra[id];
    if (tile && tile.image.complete) {
        ctx.drawImage(tile.image, rx, ry, TILE_SIZE, TILE_SIZE);
    }
}

// -- Mapping for Collision --
const COLLIDABLES = ['G', '#', 'O', '?', 'M', 'B', 'C', 'S', '[', ']', '{', '}', 'U', 'g', 'b', 'u', 'h', 'i', 'j', 'k', 'l', 'm'];
// 'S' (スター隠しブロック) もCOLLIDABLESに含めて全方向から衝突するようにする
// 'F' (ゴールポール) は重なり合うため COLLIDABLES から除外

function getTileAt(x, y) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const map = currentWorld.map;
    if (ty < 0 || ty >= map.length || tx < 0 || tx >= map[0].length) return null;
    return map[ty][tx];
}

function isSolid(x, y, includeHidden = false) {
    const tile = getTileAt(x, y);
    if (COLLIDABLES.includes(tile)) return true;
    if (includeHidden && (tile === 'S' || tile === 'I')) return true;

    // ゴールの土台 (下に'F'がない'F') も衝突対象とする
    if (tile === 'F') {
        const tileBelow = getTileAt(x, y + TILE_SIZE);
        if (tileBelow !== 'F') return true;
    }
    return false;
}

const projectiles = []; // ファイアボール等の飛び道具管理

function setTileAt(tx, ty, char) {
    const map = currentWorld.map;
    if (ty < 0 || ty >= map.length || tx < 0 || tx >= map[0].length) return;
    let row = map[ty].split('');
    row[tx] = char;
    map[ty] = row.join('');
}

// -- ファイアボール --
class Fireball {
    constructor(x, y, facing) {
        this.x = x;
        this.y = y;
        this.w = 8;
        this.h = 8;
        this.vx = facing * 3.6; // 1.5 * 2.4
        this.vy = 1.36;         // 0.57 * 2.4
        this.isDead = false;
        this.bounceCount = 0;
    }

    update() {
        this.vy += 0.4; // 重力強化 (0.05 -> 0.4) 浮遊感を解消
        this.x += this.vx;
        this.y += this.vy;

        // 床衝突（跳ね返り）
        const left = this.x + 1;
        const right = this.x + this.w - 1;
        const bottom = this.y + this.h;
        const t1 = getTileAt(left, bottom);
        const t2 = getTileAt(right, bottom);

        if (COLLIDABLES.includes(t1) || COLLIDABLES.includes(t2)) {
            this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.h;
            this.vy = -3.0; // 跳ね返る力を強化 (-1.41 -> -3.0)
        }

        // 壁衝突
        const sideX = this.vx > 0 ? this.x + this.w : this.x;
        const ts1 = getTileAt(sideX, this.y + 1);
        const ts2 = getTileAt(sideX, this.y + this.h - 1);
        if (COLLIDABLES.includes(ts1) || COLLIDABLES.includes(ts2)) {
            audioEngine.playFireballHit();
            this.spawnHitEffect();
            this.isDead = true; // 壁に当たると消滅
        }

        // 敵との衝突判定
        for (const enemy of enemies) {
            if (enemy.isDead || enemy.isFlippedDead) continue;
            if (this.x < enemy.x + enemy.w && this.x + this.w > enemy.x &&
                this.y < enemy.y + enemy.h && this.y + this.h > enemy.y) {
                enemy.die('fire', this.vx > 0 ? 1 : -1); // 演出付きで倒す
                this.spawnHitEffect();
                this.isDead = true;
                break;
            }
        }

        // 画面外（上下）
        if (this.y > (LEVEL_1_1.length + 1) * TILE_SIZE || this.y < -TILE_SIZE) {
            this.isDead = true;
        }
        // カメラ外
        if (this.x < cameraX || this.x > cameraX + WIDTH) {
            this.isDead = true;
        }
    }

    spawnHitEffect() {
        projectiles.push(new FireballHitEffect(this.x, this.y));
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);
        const sprite = assets.fireball.sprite;

        if (sprite && sprite.image.complete && sprite.image.naturalWidth !== 0) {
            withContext(ctx, () => {
                ctx.translate(dx + this.w / 2, dy + this.h / 2);
                // gameFrameに合わせて90度ずつ回転 (0, PI/2, PI, 3PI/2)
                const rot = (Math.floor(gameFrame / 4) % 4) * (Math.PI / 2);
                ctx.rotate(rot);
                ctx.drawImage(sprite.image, -this.w / 2, -this.h / 2, this.w, this.h);
            });
        } else {
            ctx.fillStyle = '#FF4500';
            ctx.beginPath();
            ctx.arc(dx + 4, dy + 4, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// -- 着弾エフェクト --
class FireballHitEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 16;
        this.h = 16;
        this.timer = 0;
        this.isDead = false;
        this.duration = 10; // 60FPS: 短縮してキビキビと
    }

    update() {
        this.timer++;
        if (this.timer >= this.duration) {
            this.isDead = true;
        }
    }

    draw(ctx) {
        const idx = Math.floor(this.timer / 8);
        const sprite = assets.fireball.hits[idx];
        if (sprite && sprite.image.complete && sprite.image.naturalWidth !== 0) {
            const dx = Math.round(this.x - cameraX - 4); // 中心を合わせるためにオフセット
            const dy = Math.round(this.y + OFFSET_Y - 4);
            ctx.drawImage(sprite.image, dx, dy, this.w, this.h);
        }
    }
}

// -- ブロック管理システム --
let blockStates = {};  // 蓄積された更新後の状態（タイル座標をキーにする）
let persistentBlockData = {}; // 永続的なブロックデータ（ヒット数、タイマーなど）
let coinEffects = [];  // コイン取得時の跳ね上がり演出
let brickParticles = []; // レンガ破壊時の破片
let scoreEffects = []; // スコア表示用のエフェクト

function getBlockKey(tx, ty) { return tx + ',' + ty; }

function affectEntitiesAboveBlock(tx, ty) {
    const blockTop = ty * TILE_SIZE;
    const blockLeft = tx * TILE_SIZE;
    const blockRight = (tx + 1) * TILE_SIZE;

    // 敵への影響
    for (const enemy of enemies) {
        if (enemy.isDead || enemy.isFlippedDead) continue;

        // エンティティがブロックの上にいるか判定（許容誤差2px）
        const isOnTop = Math.abs((enemy.y + enemy.h) - blockTop) < 2;
        const isXOverlap = enemy.x < blockRight && (enemy.x + enemy.w) > blockLeft;

        if (isOnTop && isXOverlap) {
            // 叩いた場所との相対位置で飛ばす方向を決める
            const dir = (enemy.x + enemy.w / 2 < blockLeft + TILE_SIZE / 2) ? -1 : 1;
            enemy.die('fire', dir);
        }
    }

    // アイテムへの影響
    for (const item of items) {
        if (item.isDead) continue;
        const isOnTop = Math.abs((item.y + item.h) - blockTop) < 2;
        const isXOverlap = item.x < blockRight && (item.x + item.w) > blockLeft;

        if (isOnTop && isXOverlap) {
            item.vy = -4.8; // 上に跳ね上げる (-2 * 2.4)
            if (!item.vx || item.vx === 0) item.vx = (Math.random() > 0.5 ? 1 : -1) * 1.2;
        }
    }
}

function hitBlock(tx, ty, marioRef) {
    const tile = getTileAt(tx * TILE_SIZE, ty * TILE_SIZE);
    if (!tile) return;

    // ブロックの上にあるエンティティに影響を与える
    affectEntitiesAboveBlock(tx, ty);

    const key = getBlockKey(tx, ty);
    // 連続コインブロック(C)以外は、既にバンプ中なら無視
    if (blockStates[key] && tile !== 'C') return;

    if (tile === '?' || tile === 'M' || tile === 'S' || tile === 'I') {
        // はてなブロック、アイテムブロック、隠しブロック: 中身を出して使用済みに
        blockStates[key] = { bumpY: 0, bumpTimer: 0, bumpDuration: 10, tx, ty };
        setTileAt(tx, ty, 'U');

        // タイルの文字でおこなうアイテム判定
        if (tile === 'M') {
            // パワーアップ（キノコまたはフラワー）
            audioEngine.playItemSpawn();
            if (marioRef.isSuper || marioRef.isFire) {
                items.push(new FireFlower(tx * TILE_SIZE, ty * TILE_SIZE));
            } else {
                items.push(new Mushroom(tx * TILE_SIZE, ty * TILE_SIZE));
            }
        } else if (tile === 'S') {
            // スター
            audioEngine.playItemSpawn();
            items.push(new Star(tx * TILE_SIZE, ty * TILE_SIZE));
        } else if (tile === 'I') {
            // 隠し1UPキノコ
            audioEngine.playItemSpawn();
            items.push(new OneUpMushroom(tx * TILE_SIZE, ty * TILE_SIZE));
        } else if (tile === '?') {
            // コインエフェクト
            audioEngine.playCoin();
            const startY = ty * TILE_SIZE - 8;
            coinEffects.push({
                x: tx * TILE_SIZE + TILE_SIZE / 2,
                y: startY,
                startY: startY,
                vy: -9.6, // -4 * 2.4 (速度のスケーリング)
                timer: 0,
                maxTimer: 35 // 落下距離を稼ぐため延長
            });
        }
    } else if (tile === 'C') {
        let pData = persistentBlockData[key];
        // 最初の叩きで永続データを初期化
        if (!pData) {
            pData = {
                hitsRemaining: 10,
                expiryFrame: gameFrame + (5 * 60)
            };
            persistentBlockData[key] = pData;
        }

        // バンプ演出の開始/再開 (blockStates はアニメーション用)
        blockStates[key] = {
            bumpY: 0, bumpTimer: 0, bumpDuration: 10, tx, ty
        };

        audioEngine.playCoin();
        const startY = ty * TILE_SIZE - 8;
        coinEffects.push({
            x: tx * TILE_SIZE + TILE_SIZE / 2, y: startY, startY: startY,
            vy: -9.6, timer: 0, maxTimer: 35
        });
        collectedCoins++;
        addScore(200, tx * TILE_SIZE, ty * TILE_SIZE, false);

        pData.hitsRemaining--;

        // 終了判定
        if (pData.hitsRemaining <= 0 || gameFrame > pData.expiryFrame) {
            setTileAt(tx, ty, 'U');
            delete persistentBlockData[key]; // 使用済みになったら不要なので削除
        }
    } else if (tile === '#') {
        if (marioRef.isSuper) {
            // スーパーマリオ: レンガ破壊
            setTileAt(tx, ty, ' ');
            addScore(50, tx * TILE_SIZE, ty * TILE_SIZE, false); // 数字を表示しない
            // 破片エフェクト生成（4つの破片）
            const cx = tx * TILE_SIZE + TILE_SIZE / 2;
            const cy = ty * TILE_SIZE + TILE_SIZE / 2;
            const speeds = [
                { vx: -3.6, vy: -7.2 }, // -1.5*2.4, -3*2.4
                { vx: 3.6, vy: -7.2 },
                { vx: -2.4, vy: -4.8 }, // -1*2.4, -2*2.4
                { vx: 2.4, vy: -4.8 }
            ];
            audioEngine.playBrickBreak();
            for (const s of speeds) {
                brickParticles.push({
                    x: cx, y: cy,
                    vx: s.vx, vy: s.vy,
                    timer: 0, maxTimer: 60
                });
            }
        } else {
            // ちびマリオ: バンプのみ
            audioEngine.playBump();
            blockStates[key] = { bumpY: 0, bumpTimer: 0, bumpDuration: 10, tx, ty };
        }
    } else if (tile === 'X' || tile === 'U') { // 不壊ブロックまたは使用済みブロック
        audioEngine.playBump();
        blockStates[key] = { bumpY: 0, bumpTimer: 0, bumpDuration: 10, tx, ty };
    }
}

function updateBlockStates() {
    for (const key in blockStates) {
        const state = blockStates[key];
        state.bumpTimer++;
        const half = state.bumpDuration / 2;
        if (state.bumpTimer <= half) {
            state.bumpY = -(state.bumpTimer / half) * 6; // 上に6px移動
        } else {
            state.bumpY = -6 + ((state.bumpTimer - half) / half) * 6; // 戻る
        }
        if (state.bumpTimer >= state.bumpDuration) {
            delete blockStates[key];
        }
    }
}

function updateCoinEffects() {
    for (let i = coinEffects.length - 1; i >= 0; i--) {
        const c = coinEffects[i];
        c.y += c.vy;
        c.vy += 1.15; // 0.2 * 5.76 (重力のスケーリング)
        c.timer++;

        // 消滅判定: 出現位置(startY)付近まで落ちてきたら消す、またはタイマー満了
        if ((c.vy > 0 && c.y >= c.startY) || c.timer >= c.maxTimer) {
            coinEffects.splice(i, 1);
        }
    }
}

function updateBrickParticles() {
    for (let i = brickParticles.length - 1; i >= 0; i--) {
        const p = brickParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.86; // 0.15 * 5.76
        p.timer++;
        if (p.timer >= p.maxTimer) {
            brickParticles.splice(i, 1);
        }
    }
}

function drawCoinEffects(ctx) {
    for (const c of coinEffects) {
        // 描画の中心座標
        const cx = Math.round(c.x - cameraX);
        const cy = Math.round(c.y + OFFSET_Y);

        // タイマーに基づいたアニメーション（0〜3の4段階）
        const animStep = Math.floor(c.timer / 2) % 4; // 速度を2倍(4->2)に向上
        const tile = assets.getedCoin[animStep];

        // コイン画像の描画
        if (tile && tile.image.complete && tile.image.naturalWidth !== 0) {
            // アスペクト比を維持しつつ、最大辺を 12px に制限してスケーリング
            const nw = tile.image.naturalWidth;
            const nh = tile.image.naturalHeight;
            const scale = 12 / Math.max(nw, nh);
            const targetW = nw * scale;
            const targetH = nh * scale;

            ctx.drawImage(tile.image, 0, 0, nw, nh, cx - targetW / 2, cy - targetH / 2, targetW, targetH);
        } else {
            // フォールバック
            const dx = cx - 4;
            const dy = cy - 4;
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(dx, dy, 8, 8);
            ctx.fillStyle = '#FFA500';
            ctx.fillRect(dx + 2, dy + 2, 4, 4);
        }
    }
}

function drawBrickParticles(ctx) {
    const effect = assets.breakEffect;
    for (const p of brickParticles) {
        const dx = Math.round(p.x - cameraX - 4);
        const dy = Math.round(p.y + OFFSET_Y - 4);
        if (effect && effect.image.complete) {
            ctx.drawImage(effect.image, dx, dy, 8, 8);
        } else {
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(dx, dy, 8, 8);
        }
    }
}

// -- Score System --
class FloatingScore {
    constructor(text, x, y) {
        this.text = text.toString();
        this.x = x;
        this.y = y;
        this.timer = 0;
        this.duration = 45; // 表示フレーム数
        this.vy = -1.2;     // 上へ少し早く移動
        this.isDead = false;
    }

    update() {
        this.y += this.vy;
        // 徐々に遅くする
        this.vy *= 0.95;
        this.timer++;
        if (this.timer >= this.duration) {
            this.isDead = true;
        }
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);
        // 横方向をさらに絞る (X: 0.5, Y: 0.7)
        drawText(ctx, this.text, dx, dy, 0.5, 0.7);
    }
}

function addScore(points, x, y, showText = true) {
    if (typeof points === 'number' && points > 0) {
        currentScore += points;
    } else if (points === "1UP") {
        // 音を鳴らすなどの処理を入れる場所 (1UP🍄や連続踏みなどで呼ばれる)
        // livesRemaining++ は別途呼び出し元でやるか、ここでやるか。一旦ここで処理する
        livesRemaining++;
        audioEngine.play1Up();
    }
    if (showText) {
        scoreEffects.push(new FloatingScore(points, x, y));
    }
}

function updateScoreEffects() {
    for (let i = scoreEffects.length - 1; i >= 0; i--) {
        const s = scoreEffects[i];
        s.update();
        if (s.isDead) scoreEffects.splice(i, 1);
    }
}

function drawScoreEffects(ctx) {
    for (const s of scoreEffects) {
        s.draw(ctx);
    }
}

// -- Items --
class FireFlower {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 16;
        this.h = 16;
        this.isSpawned = false;
        this.spawnStartY = y;
        this.isDead = false;
        this.spawnTimer = 0;
        this.spawnStep = 0;
    }

    update() {
        if (!this.isSpawned) {
            this.spawnTimer++;
            // 6 / 2.4 = 2.5 -> 約3フレームごとに1段階
            // 出現速度: 3 -> 6 (さらにゆっくり)
            if (this.spawnTimer % 6 === 0) {
                this.spawnStep++;
                this.y = this.spawnStartY - (16 * (this.spawnStep / 8));
                if (this.spawnStep >= 8) {
                    this.y = this.spawnStartY - 16;
                    this.isSpawned = true;
                }
            }
        }
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);

        // アニメーションをもっと速くし、1番目の画像(インデックス0)の割合を多くする
        const animPattern = [0, 0, 0, 1, 2, 3, 2, 1];
        const animIdx = animPattern[Math.floor(gameFrame / 3) % animPattern.length];
        const flowerAsset = assets.items.fireFlower[animIdx];
        const img = flowerAsset ? flowerAsset.image : null;

        if (img && img.complete && img.naturalWidth !== 0) {
            ctx.save();

            // 出現中のクリッピング
            if (!this.isSpawned) {
                const clipY = Math.round(this.spawnStartY + OFFSET_Y);
                ctx.beginPath();
                ctx.rect(dx, clipY - 32, this.w, 32);
                ctx.clip();
            }

            // 画像全体を 16x16 に描画 (nw, nh をそのまま使用して歪みを防ぐ)
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, this.w, this.h);

            ctx.restore();
        } else {
            // フォールバック
            const brightness = [1.0, 0.8, 0.6, 0.8][animIdx];
            ctx.fillStyle = `rgba(255, 100, 100, ${brightness})`;
            ctx.fillRect(dx, dy, this.w, this.h);
        }
    }

    checkMarioCollision(mario) {
        // 出現完了後のみ、かつマリオが生きている時のみ判定
        if (mario.isDead || !this.isSpawned || this.isDead) return;

        // 当たり判定を少し厳しく（中央寄りに）して、ブロックを突き抜けて取れないようにする
        const margin = 2;
        if (mario.x < this.x + this.w - margin && mario.x + mario.hitW > this.x + margin &&
            mario.y < this.y + this.h && mario.y + mario.hitH > this.y) {
            this.isDead = true;
            addScore(1000, this.x, this.y, false);
            audioEngine.playPowerUp();
            mario.getFireFlower();
        }
    }
}

class Mushroom {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 16;
        this.h = 16;
        this.vx = 0;
        this.vy = 0;
        this.isSpawned = false;
        this.spawnStartY = y;
        this.isDead = false;

        // 出現アニメーション用変数
        this.spawnStep = 0;
        this.spawnMaxSteps = 30; // 出現にかかるフレーム数（ゆっくり）
        this.spawnTimer = 0;
    }

    update() {
        if (!this.isSpawned) {
            this.spawnTimer++;
            // 4 / 2.4 = 1.6 -> 2フレームごとに
            // 出現速度: 2 -> 5 (かなりゆっくり)
            if (this.spawnTimer % 5 === 0) {
                this.spawnStep++;
                this.y = this.spawnStartY - (16 * (this.spawnStep / 10));

                if (this.spawnStep >= 10) {
                    this.y = this.spawnStartY - 16;
                    this.isSpawned = true;
                    this.vx = 1.2; // 0.5 * 2.4
                }
            }
            return;
        }

        // 落下時「ストンと落ちる」のを防ぐため、重力をさらに弱くし、最大落下速度(終端速度)もさらに下げる
        this.vy += 0.46; // 0.08 * 5.76
        if (this.vy > 2.88) {
            this.vy = 2.88; // 1.2 * 2.4
        }
        this.y += this.vy;

        // 簡易的な床・壁判定
        const left = this.x;
        const right = this.x + this.w - 1;
        const bottom = this.y + this.h;

        if (this.vy >= 0) {
            const t1 = getTileAt(left, bottom);
            const t2 = getTileAt(right, bottom);
            if (COLLIDABLES.includes(t1) || COLLIDABLES.includes(t2)) {
                this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.h;
                this.vy = 0;
            }
        }

        this.x += this.vx;
        if (this.vx > 0) {
            const tr1 = getTileAt(Math.floor((this.x + this.w) / TILE_SIZE) * TILE_SIZE, this.y + 2);
            if (COLLIDABLES.includes(tr1)) {
                this.vx = -this.vx;
                this.x = Math.floor((this.x + this.w) / TILE_SIZE) * TILE_SIZE - this.w;
            }
        } else if (this.vx < 0) {
            const tl1 = getTileAt(Math.floor(this.x / TILE_SIZE) * TILE_SIZE, this.y + 2);
            if (COLLIDABLES.includes(tl1)) {
                this.vx = -this.vx;
                this.x = Math.floor(this.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE;
            }
        }

        if (this.y > LEVEL_1_1.length * TILE_SIZE) {
            this.isDead = true;
        }
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);
        const img = assets.items.mushroom.image;

        if (img && img.complete) {
            if (!this.isSpawned) {
                // 出現中は、ブロックの下に隠れている部分を描画しないようクリッピングする
                ctx.save();
                // 描画領域を「ブロックの上端（spawnStartY）より上」に制限
                const clipY = Math.round(this.spawnStartY + OFFSET_Y);
                ctx.beginPath();
                ctx.rect(dx, clipY - 32, this.w, 32); // 上方向に適当な余裕を持たせる
                ctx.clip();
                ctx.drawImage(img, dx, dy, this.w, this.h);
                ctx.restore();
            } else {
                ctx.drawImage(img, dx, dy, this.w, this.h);
            }
        } else {
            ctx.fillStyle = '#f00';
            ctx.fillRect(dx, dy, this.w, this.h);
        }
    }

    checkMarioCollision(marioRef) {
        if (this.isDead || !this.isSpawned || marioRef.isDead || marioRef.isTransforming) return;

        // AABB 衝突判定
        if (marioRef.x < this.x + this.w &&
            marioRef.x + marioRef.w > this.x &&
            marioRef.y < this.y + this.h &&
            marioRef.y + marioRef.h > this.y) {

            this.isDead = true;
            // スーパーマリオでない場合は数字を出さずに加算
            addScore(1000, this.x, this.y, marioRef.isSuper);
            if (!marioRef.isSuper) {
                audioEngine.playPowerUp();
                // 即座に大きくするのではなく、変身アニメーションを開始する
                marioRef.isTransforming = true;
                marioRef.transformTimer = 0;
                marioRef.transformState = 0; // 0:ちび 1:スーパー
                marioRef.transformType = 0;  // ちび->スーパー
            }
        }
    }
}

class OneUpMushroom extends Mushroom {
    constructor(x, y) {
        super(x, y);
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);
        const mushroomAsset = assets.items.oneUpMushroom;
        const img = mushroomAsset ? mushroomAsset.image : null;

        if (img && img.complete) {
            if (!this.isSpawned) {
                ctx.save();
                const clipY = Math.round(this.spawnStartY + OFFSET_Y);
                ctx.beginPath();
                ctx.rect(dx, clipY - 32, this.w, 32);
                ctx.clip();
                ctx.drawImage(img, dx, dy, this.w, this.h);
                ctx.restore();
            } else {
                ctx.drawImage(img, dx, dy, this.w, this.h);
            }
        } else {
            ctx.fillStyle = '#0f0';
            ctx.fillRect(dx, dy, this.w, this.h);
        }
    }

    checkMarioCollision(marioRef) {
        if (this.isDead || !this.isSpawned || marioRef.isDead || marioRef.isTransforming) return;

        if (marioRef.x < this.x + this.w &&
            marioRef.x + marioRef.w > this.x &&
            marioRef.y < this.y + this.h &&
            marioRef.y + marioRef.h > this.y) {

            this.isDead = true;
            addScore("1UP", this.x, this.y);
        }
    }
}

class Star {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 16;
        this.h = 16;
        this.vx = 0;
        this.vy = 0;
        this.isSpawned = false;
        this.spawnStartY = y;
        this.isDead = false;
        this.spawnStep = 0;
        this.spawnTimer = 0;
    }

    update() {
        if (!this.isSpawned) {
            this.spawnTimer++;
            // 4 / 2.4 = 1.6 -> 2フレームごとに
            // 出現速度: 2 -> 5 (かなりゆっくり)
            if (this.spawnTimer % 5 === 0) {
                this.spawnStep++;
                this.y = this.spawnStartY - (16 * (this.spawnStep / 10));
                if (this.spawnStep >= 10) {
                    this.y = this.spawnStartY - 16;
                    this.isSpawned = true;
                    this.vx = 0.7; // 1.2 -> 0.7 (さらに遅く)
                    this.vy = -3.2; // -4.8 -> -3.2 (抑制)
                }
            }
            return;
        }

        this.vy += 0.3; // 0.86 -> 0.3 (重力を大幅に小さくして浮遊感を出す)
        this.y += this.vy;
        this.x += this.vx;

        // 地面衝突判定 (バウンド)
        const left = this.x;
        const right = this.x + this.w - 1;
        const bottom = this.y + this.h;

        if (this.vy >= 0) {
            const t1 = getTileAt(left, bottom);
            const t2 = getTileAt(right, bottom);
            if (COLLIDABLES.includes(t1) || COLLIDABLES.includes(t2)) {
                this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.h;
                this.vy = -3.2; // -4.8 -> -3.2 (ふわっとバウンド)
            }
        }

        // 壁衝突判定
        if (this.vx > 0) {
            const tr = getTileAt(this.x + this.w, this.y + 2);
            if (COLLIDABLES.includes(tr)) {
                this.vx = -this.vx;
                this.x = Math.floor((this.x + this.w) / TILE_SIZE) * TILE_SIZE - this.w;
            }
        } else if (this.vx < 0) {
            const tl = getTileAt(this.x, this.y + 2);
            if (COLLIDABLES.includes(tl)) {
                this.vx = -this.vx;
                this.x = (Math.floor(this.x / TILE_SIZE) + 1) * TILE_SIZE;
            }
        }

        if (this.y > LEVEL_1_1.length * TILE_SIZE) this.isDead = true;
    }

    draw(ctx) {
        const dx = Math.round(this.x - cameraX);
        const dy = Math.round(this.y + OFFSET_Y);

        // 2フレーム周期で4枚の画像を切り替え
        const animIdx = Math.floor(gameFrame / 2) % 4;
        const starAsset = assets.items.star[animIdx];
        const img = starAsset.image;

        if (img && img.complete && img.naturalWidth !== 0) {
            ctx.save();

            // 画像全体を使用（16の倍数へのクリッピングを廃止）
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;

            if (!this.isSpawned) {
                const clipY = Math.round(this.spawnStartY + OFFSET_Y);
                ctx.beginPath();
                ctx.rect(dx, clipY - 32, this.w, 32);
                ctx.clip();
                ctx.drawImage(img, 0, 0, nw, nh, dx, dy, this.w, this.h);
            } else {
                ctx.drawImage(img, 0, 0, nw, nh, dx, dy, this.w, this.h);
            }
            ctx.restore();
        } else {
            // フォールバック
            const brightness = (animIdx < 2) ? 1.0 : 0.6;
            ctx.fillStyle = `rgb(${255 * (brightness / 2)}, ${255 * (brightness / 2)}, 0)`;
            ctx.fillRect(dx, dy, this.w, this.h);
        }
    }

    checkMarioCollision(mario) {
        if (this.isDead || !this.isSpawned || mario.isDead || mario.isTransforming) return;

        if (mario.x < this.x + this.w && mario.x + mario.hitW > this.x &&
            mario.y < this.y + this.h && mario.y + mario.hitH > this.y) {
            this.isDead = true;
            currentScore += 1000; // スコア加算
            mario.isInvincibleStar = true;
            mario.starTimer = mario.starMaxTimer;
            audioEngine.playStarBGM();
            // 他の無敵タイマーも延長
            mario.isInvincible = true;
            mario.invincibilityTimer = mario.starMaxTimer;
        }
    }
}

// -- Coin Class (Map Items) --
class Coin {
    constructor(x, y) {
        this.x = x + (16 - 10) / 2; // タイル(16px)内の中央(3pxオフセット)に配置
        this.y = y;
        this.w = 10; // 横幅を小さく (16 -> 10)
        this.h = 14; // 高さを少し小さく (16 -> 14)
        this.isDead = false;

        // アニメーション用 (1 -> 2 -> 3 -> 2 -> 1)
        this.sequence = [1, 2, 3, 2];
        this.seqIndex = 0;
        this.timer = 0;
    }

    update() {
        this.timer++;

        // 1の時は30フレーム、それ以外は8フレーム
        const currentFrame = this.sequence[this.seqIndex];
        const duration = (currentFrame === 1) ? 30 : 8;

        if (this.timer >= duration) {
            this.timer = 0;
            this.seqIndex = (this.seqIndex + 1) % this.sequence.length;
        }
    }

    draw(ctx) {
        const frame = this.sequence[this.seqIndex];
        const sprite = assets.items['underCoin' + frame];
        if (sprite && sprite.image.complete) {
            // すでに this.x がタイル内で中央寄せされているため、そのまま描画
            const dx = Math.round(this.x - cameraX);
            const dy = Math.round(this.y + OFFSET_Y);
            ctx.drawImage(sprite.image, dx, dy, this.w, this.h);
        }
    }

    checkMarioCollision(mario) {
        if (mario.isDead || this.isDead) return;

        // AABB 衝突判定
        if (mario.x < this.x + this.w &&
            mario.x + mario.w > this.x &&
            mario.y < this.y + this.h &&
            mario.y + mario.h > this.y) {
            this.isDead = true;
            currentScore += 200; // スコア加算
            collectedCoins++; // コイン加算
            audioEngine.playCoin();
            if (collectedCoins >= 100) {
                collectedCoins = 0;
                livesRemaining++; // 1UP
            }
        }
    }
}

// -- Mario Class --
class Mario {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.isSuper = false;
        this.isFire = false;  // ファイアマリオ状態フラグを追加

        // 当たり判定用のサイズ (NES準拠/調整)
        this.hitW = this.isSuper ? 16 : 14; // 再調整（20 -> 16）
        this.hitH = this.isSuper ? 32 : 16;

        // 描画用のサイズ (アセットの正方形に合わせて調整)
        // 元のアセットが正方形(512x512)なので、描画も正方形にする
        this.drawW = this.isSuper ? 32 : 16;
        this.drawH = this.isSuper ? 32 : 16;

        this.vx = 0;
        this.vy = 0;
        this.facing = 1; // 1: Right, -1: Left
        this.animFrame = 0;
        this.animState = 'neutral';
        this.isOnGround = false;
        this.stompCount = 0;
        this.isDucking = false;
        this.jumpKeyPrev = false; // ジャンプボタンの長押し制限用
        this.fireKeyPrev = false; // ファイアボタンの連打制限用

        // 変身の種類 (0: ちび->スーパー, 1: スーパー->ファイア)
        this.transformType = 0;

        // 死亡アニメーション用
        this.isDead = false;
        this.deathTimer = 0;
        this.deathPhase = 0; // 0: 一時停止, 1: 上昇, 2: 落下

        // 変身アニメーション用
        this.isTransforming = false;
        this.transformTimer = 0;
        this.transformMaxTimer = 36; // 3フレーム x 3段階 x 4ループ = 36
        this.transformState = 0;     // 0:ちび, 1:24px, 2:32px

        // 退化（ダメージ時）アニメーション用
        this.isShrinking = false;
        this.shrinkTimer = 0;
        this.shrinkMaxTimer = 30; // 75 / 2.5
        this.shrinkState = 0; // 0:ちび, 1:スーパー
        this.shrinkType = 0;  // 0: 大->小, 1: ファイア->大 (追加)

        // 土管遷移用
        this.pipeSequence = null; // 'entering', 'exiting', 'entering_right', 'exiting_right'
        this.pipeTimer = 0;
        this.pipeMaxTimer = 60;
        this.pipeDest = null; // {worldId, x, y}

        // 無敵時間用
        this.isInvincible = false;
        this.invincibilityTimer = 0;
        this.invincibilityMaxTimer = 120; // 約2秒間

        // スター無敵
        this.isInvincibleStar = false;
        this.starTimer = 0;
        this.starMaxTimer = 600; // 10秒間(60FPS固定後)

        // ゴールシーケンス用
        this.isGoalSequence = false;
        this.goalPhase = 0; // 0: sliding, 1: walking
        this.goalTimer = 0;
        this.goalFlagY = 0; // ポール上での旗のY座標差分
        this.goalStartY = y; // ゴール開始時のY座標を記録
        this.isHiddenInCastle = false; // お城に入った時に消す用
        this.isCastleFlagRising = false;
        this.castleFlagY = 0;

        // 初期位置調整
        if (this.isSuper) this.y -= 16;
    }

    get w() { return this.hitW; }
    get h() { return this.hitH; }

    die(fallDeath = false) {
        if (this.isDead) return;
        this.isDead = true;
        this.isSuper = false; // 死亡時はちび状態にリセット
        this.deathTimer = 0;
        this.deathPhase = fallDeath ? 2 : 0; // 奈落落下時はフェーズ2（そのまま落下）
        this.vx = 0;
        if (!fallDeath) this.vy = 0;
        this.animState = 'gameover';
        audioEngine.playDeath();
    }

    takeDamage() {
        if (this.isDead || this.isTransforming || this.isShrinking || this.isInvincible) return;

        if (this.isSuper || this.isFire) {
            // スーパーまたはファイアなら退化（ダメージ演出）開始
            this.wasFire = this.isFire; // 退化中のスプライト判定用
            this.isShrinking = true;
            this.shrinkTimer = 0;
            this.shrinkState = 1; // 1:大きい状態から開始
            this.isInvincible = true;
            this.invincibilityTimer = this.invincibilityMaxTimer;

            if (this.isFire) {
                // ファイアからスーパーへの退化
                this.shrinkType = 1;
                this.isFire = false;
                this.isSuper = true;
                audioEngine.playShrink();
                // ヒットボックスや座標は維持 (20px)
            } else {
                // スーパーからちびへの退化
                this.shrinkType = 0;
                const prevW = this.hitW;
                this.isSuper = false;
                this.isFire = false;
                audioEngine.playShrink();
                this.y += 16;
                this.hitW = 14;
                this.hitH = 16;
                this.drawW = 16;
                this.drawH = 16;
                // 中心を維持するようにX座標を補正
                this.x += (prevW - this.hitW) / 2;
            }
        } else {
            // ちびマリオなら死亡
            this.die();
        }
    }

    getFireFlower() {
        if (this.isDead || this.isTransforming || this.isShrinking) return;

        // すでにファイア状態ならアニメーションをスキップ
        if (this.isFire) return;

        // 変身アニメーション開始
        this.isTransforming = true;
        this.transformTimer = 0;
        this.transformState = 0; // 0:スーパー, 1:ファイア
        this.transformType = 1;  // ファイア変身モード

        // ヒットボックスなどは変身完了後に更新するのが本来だが、
        // 描画との整合性のために一旦スーパーの状態にする
        this.isSuper = true;
        this.hitH = 32;
        this.drawW = 32;
        this.drawH = 32;
    }

    shootFireball() {
        if (!this.isFire || this.isDead || this.isTransforming || this.isShrinking) return;

        // 画面内のファイアボール数を制限（例：2発まで）
        if (projectiles.length < 2) {
            const fbX = this.facing === 1 ? this.x + this.hitW : this.x - 8;
            const fbY = this.y + 12;
            projectiles.push(new Fireball(fbX, fbY, this.facing));
            audioEngine.playFireball();
        }
    }

    updateDeath() {
        this.deathTimer++;

        if (this.deathPhase === 0) {
            // フェーズ0: 一時停止（約0.5秒 = 30フレーム）
            if (this.deathTimer > 30) {
                this.deathPhase = 1;
                this.vy = -4.0; // 上にジャンプ（高度を強化: -1.8 -> -4.0）
            }
        } else {
            // フェーズ1: ジャンプ後落下 / フェーズ2: 奈落落下（ジャンプなし）
            this.vy += GRAVITY * 0.4;
            this.y += this.vy;

            // 画面外に落ちたらリスポーン
            const mapBottom = LEVEL_1_1.length * TILE_SIZE + 64;
            if (this.y > mapBottom) {
                this.respawn();
            }
        }
    }

    respawn() {
        livesRemaining--;
        if (livesRemaining <= 0 || window.isTimeUp) {
            currentGameState = STATE_GAMEOVER;
            audioEngine.playGameOver();
            return;
        }

        // LOADING状態へ遷移
        currentGameState = STATE_LOADING;
        loadingTimer = 0;
        loadingBlackFrames = 0;

        // レベルリセット（パワーアップは解除、中間ポイントからの再開を試みる）
        resetLevel('1-1', true, true);
    }




    updateTransform() {
        this.transformTimer++;

        // 3フレームごとに状態を更新 (0, 1, 2) - 計4ループ
        this.transformState = Math.floor(this.transformTimer / 3) % 3;

        if (this.transformTimer >= this.transformMaxTimer) {
            this.isTransforming = false;
            if (this.transformType === 0) {
                // ちび -> スーパー
                const prevW = this.hitW;
                this.isSuper = true;
                this.y -= 16;
                this.hitW = 16;
                this.hitH = 32;
                this.drawW = 32;
                this.drawH = 32;
                // 中心を維持するようにX座標を補正
                this.x += (prevW - this.hitW) / 2;
            } else {
                // スーパー -> ファイア
                this.isFire = true;
                this.isSuper = true;
                // サイズ等は既にスーパーなので変更なし
            }
        }
    }

    updateShrink() {
        this.shrinkTimer++;

        // 3フレームごとに状態を更新 (2 -> 1 -> 0)
        this.shrinkState = 2 - (Math.floor(this.shrinkTimer / 3) % 3);

        if (this.shrinkTimer >= this.shrinkMaxTimer) {
            this.isShrinking = false;
            // すでにtakeDamageで座標・サイズ等は調整済み
        }
    }

    updateGoalSequence() {
        this.goalTimer++;
        if (this.goalPhase === 0) {
            // フェーズ0: ポールを滑り降りる
            this.vx = 0;
            this.vy = 0;

            if (this.goalTimer === 1) {
                // 1. 掴んだ瞬間に pole_start
                audioEngine.playPoleStart();
                // 数フレーム後にループ音を開始するための準備
            }
            if (this.goalTimer === 15) {
                // 2. 少し滑ってからループ開始
                this.poleLoopSound = audioEngine.playPoleLoop();
            }

            // マリオの足元にブロックがあるかチェック
            const checkX = this.x + 12;
            const footY = this.y + this.hitH + 1;
            const isOnBlock = isSolid(checkX, footY);

            // 地面に着く寸前（例えばあと4pxで着地）を検知して pole_end を鳴らす
            const isNearGround = isSolid(checkX, this.y + this.hitH + 5);

            if (!isOnBlock) {
                // 滑り降りる (2px/frame)
                this.y += 2;

                if (isNearGround && this.poleLoopSound) {
                    // 3. 降り終わる直前に loop を止めて end を鳴らす
                    audioEngine.stopSound(this.poleLoopSound);
                    this.poleLoopSound = null;
                    audioEngine.playPoleEnd();
                }

                if (isSolid(checkX, this.y + this.hitH + 1)) {
                    this.y = Math.floor((this.y + this.hitH + 1) / TILE_SIZE) * TILE_SIZE - this.hitH;
                }

                this.goalFlagY = this.y - this.goalStartY;
                this.animState = 'sliding';
            } else {
                // 地面に到着
                if (this.poleLoopSound) {
                    audioEngine.stopSound(this.poleLoopSound);
                    this.poleLoopSound = null;
                }
                this.goalPhase = 1;
                this.goalTimer = 0;
                this.animState = 'sliding';
            }
        } else if (this.goalPhase === 1) {
            // フェーズ1: 少し待ってから反転 → 飛び降りる
            this.vx = 0;
            this.vy = 0;

            if (this.goalTimer === 1) {
                audioEngine.playGoal();
            }

            if (this.goalTimer === 30) {
                // 30フレーム後にポールの右側へ反転 (画像の反転で滑らかな演出)
                this.facing = -1; // 左を向く（ポールにしがみつく画像のまま反転）
                this.x += 16; // ポールの反対側へ対称に移動
            }
            if (this.goalTimer === 45) {
                // さらに15フレーム待ったあとに、右を向いて飛び降りる
                this.facing = 1;
                this.vy = -2.5;
                this.vx = 1.0;
            }
            if (this.goalTimer > 45) {
                // ジャンプ中の物理演算
                this.vy += GRAVITY;
                this.x += this.vx;
                this.y += this.vy;
                this.animState = 'jump';

                // 着地判定
                const bottom = this.y + this.hitH;
                if (isSolid(this.x + 1, bottom) || isSolid(this.x + this.hitW - 1, bottom)) {
                    this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.hitH;
                    this.vy = 0;
                    this.isOnGround = true;
                    // 着地したらフェーズ2へ
                    this.goalPhase = 2;
                    this.goalTimer = 0;
                }
            }
        } else if (this.goalPhase === 2) {
            // フェーズ2: 自動で右に歩く
            // お城のドアの位置 (202列目 + お城の幅の半分弱)
            const castleDoorX = 204.5 * TILE_SIZE;

            if (this.x < castleDoorX) {
                this.vx = 1.6;
                this.animFrame += Math.abs(this.vx) * 0.2;
            } else {
                // ドアに到達
                this.vx = 0;
                this.isHiddenInCastle = true;
            }

            this.vy += GRAVITY;
            this.x += this.vx;
            this.y += this.vy;

            // 地面との当たり判定（簡易版）
            const bottom = this.y + this.hitH;
            const txLeft = Math.floor((this.x + 2) / TILE_SIZE);
            const txRight = Math.floor((this.x + this.hitW - 2) / TILE_SIZE);
            if (isSolid(txLeft * TILE_SIZE, bottom) || isSolid(txRight * TILE_SIZE, bottom)) {
                this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.hitH;
                this.vy = 0;
                this.isOnGround = true;
            }

            // タイムボーナス加算処理 (1フレームに2カウント減らす = 高速集計)
            if (levelTimer > 0) {
                const dec = Math.min(levelTimer, 2);
                levelTimer -= dec;
                currentScore += dec * 50;

                // 3フレームに1回の間隔で音を鳴らす (60FPSで早すぎるとノイズになるため)
                if (levelTimer % 3 === 0 || levelTimer === 0) {
                    audioEngine.playCountDown();
                }

                // タイマー集計中はクリア待機タイマーを延長して画面移行を防ぐ
                this.goalTimer = 150;
            } else if (this.isHiddenInCastle) {
                // タイマー加算が終わり、かつお城に入っている場合、旗を上げる
                this.isCastleFlagRising = true;
            }

            // 旗の上昇アニメーション
            if (this.isCastleFlagRising && this.castleFlagY < 15) {
                this.castleFlagY += 1.0; // 旗がせり上がる速度
            }

            // 画面外、あるいは一定時間経過でクリア処理
            if (this.goalTimer > 300 && levelTimer === 0) {
                // クリア後もスコア・コイン・残機は維持する
                // 次のレベル（今回は1-1をループ）の準備
                resetLevel('1-1', false); // パワーアップは維持しても良いが、一旦SMB1に合わせて解除するか検討。ここでは維持(false)。

                // タイトル画面に遷移
                currentGameState = STATE_TITLE;
            }
        }
    }

    updatePipeSequence() {
        this.pipeTimer++;
        const distance = this.hitH;
        const maxTimer = distance / 0.5;

        if (this.pipeSequence === 'entering') {
            this.y += 0.5;
            if (this.pipeTimer >= maxTimer) {
                const dest = this.pipeDest;
                this.pipeSequence = (dest.isFall) ? null : 'exiting';
                this.pipeTimer = 0;
                switchWorld(dest.worldId, dest.x, dest.y);
                this.pipeBoundaryY = this.y; // 出口の表面（テレポ後の位置は口の高さ）
            }
        } else if (this.pipeSequence === 'exiting') {
            this.y -= 0.5;
            if (this.pipeTimer >= maxTimer) {
                this.pipeSequence = null;
            }
        } else if (this.pipeSequence === 'entering_right') {
            this.x += 0.5;
            if (this.pipeTimer >= maxTimer) {
                const dest = this.pipeDest;
                this.pipeSequence = (dest.isFall) ? null : 'exiting';
                this.pipeTimer = 0;
                switchWorld(dest.worldId, dest.x, dest.y);
                this.pipeBoundaryY = this.y; // 出口の表面
            }
        }
    }

    update() {
        if (this.isGoalSequence) {
            this.updateGoalSequence();
            this.updateAnimation();
            return;
        }
        if (this.pipeSequence) {
            this.updatePipeSequence();
            return;
        }

        // 中間ポイントのチェック (83列目: 二つ目の奈落の3マス手前)
        if (!hasReachedCheckpoint && currentWorld && currentWorld.id === '1-1') {
            if (this.x > 83 * TILE_SIZE) {
                hasReachedCheckpoint = true;
            }
        }

        if (this.invincibilityTimer > 0) {
            this.invincibilityTimer--;
            if (this.invincibilityTimer <= 0) this.isInvincible = false;
        }

        if (this.starTimer > 0) {
            this.starTimer--;
            if (this.starTimer <= 0) {
                this.isInvincibleStar = false;
                audioEngine.stopStarBGM();
            }
        }

        if (keys['ArrowDown']) {
            if (!currentWorld.isUnderground && !this.pipeSequence && this.isOnGround) {
                const leftFootX = this.x + 4;
                const rightFootX = this.x + this.hitW - 4;
                const footY = this.y + this.hitH + 1;
                const tileL = getTileAt(leftFootX, footY);
                const tileR = getTileAt(rightFootX, footY);
                const tx = Math.floor((this.x + this.hitW / 2) / TILE_SIZE);

                if (tileL === '[' && tileR === ']' && tx >= 57 && tx <= 58) {
                    this.pipeSequence = 'entering';
                    this.pipeTimer = 0;
                    this.pipeBoundaryY = this.y + this.hitH; // 土管の表面（マリオの足元）
                    this.x = 57 * TILE_SIZE + (TILE_SIZE * 2 - this.hitW) / 2;
                    this.pipeDest = { worldId: '1-1_under', x: 2 * TILE_SIZE, y: -2 * TILE_SIZE, isFall: true };
                    this.vx = 0;
                    audioEngine.playShrinkPipe();
                    return;
                }
            }

            if (this.isSuper) {
                if (!this.isDucking) {
                    this.isDucking = true;
                    // 足元の位置を一定に保つため、Y座標を調整
                    this.y += 16;
                    this.hitH = 16;
                }
                // しゃがみ中の摩擦（地上のみ）
                if (this.isOnGround) {
                    if (this.vx > 0) this.vx = Math.max(0, this.vx - FRICTION);
                    else if (this.vx < 0) this.vx = Math.min(0, this.vx + FRICTION);
                }
            }
        } else {
            if (this.isDucking) {
                this.isDucking = false;
                // 立った時に頭がめり込まないかチェック（簡易的：ここではY座標を上にずらす）
                this.y -= 16;
                this.hitH = this.isSuper ? 32 : 16;
            }
        }

        // しゃがんでいても/空中にいても横移動や慣性の処理を実行する
        // （ただし、しゃがんでいて地上にいるときは操作不可）
        if (!(this.isDucking && this.isOnGround)) {
            const isRun = keys['ShiftLeft'] || keys['ShiftRight'] || keys['KeyZ'] || keys['KeyX'];
            let currentAccel = isRun ? ACCEL_RUN : ACCEL_WALK;
            let currentMaxSpeed = isRun ? MAX_RUN_SPEED : MAX_WALK_SPEED;
            let currentFriction = FRICTION;

            // 空中にいるときは横移動の操作性と空気抵抗(摩擦)を鈍くする
            if (!this.isOnGround) {
                currentAccel *= 0.4;    // 空中での加速を弱くする
                currentFriction *= 0.2; // 空中でキーを離しても急に止まらないようにする
            }

            if (this.isInvincibleStar) {
                currentAccel *= 1.2;
                currentMaxSpeed *= 1.2;
            }

            const fireKeyTyped = (keys['KeyX'] || keys['ShiftLeft'] || keys['ShiftRight']);
            if (fireKeyTyped && !this.fireKeyPrev) this.shootFireball();
            this.fireKeyPrev = fireKeyTyped;

            if (keys['ArrowRight']) {
                this.vx += currentAccel;
                if (this.vx > currentMaxSpeed) this.vx = currentMaxSpeed;
                if (this.isOnGround) this.facing = 1;
            } else if (keys['ArrowLeft']) {
                this.vx -= currentAccel;
                if (this.vx < -currentMaxSpeed) this.vx = -currentMaxSpeed;
                if (this.isOnGround) this.facing = -1;
            } else {
                if (this.vx > 0) this.vx = Math.max(0, this.vx - currentFriction);
                else if (this.vx < 0) this.vx = Math.min(0, this.vx + currentFriction);
            }
        }

        const jumpPressed = keys['Space'] || keys['ArrowUp'];
        if (jumpPressed && !this.jumpKeyPrev && this.isOnGround) {
            this.vy = JUMP_SPEED;
            this.isOnGround = false;
            if (this.isSuper || this.isFire) {
                audioEngine.playJumpBig();
            } else {
                audioEngine.playJump();
            }
        }
        this.jumpKeyPrev = jumpPressed;

        if (this.vy < 0 && !jumpPressed) this.vy *= 0.9;

        const currentGravity = this.vy < 0 ? GRAVITY_ASCENT : GRAVITY;
        this.vy += currentGravity;

        // 落下速度の制限 (終端速度)
        if (this.vy > MAX_FALL_SPEED) {
            this.vy = MAX_FALL_SPEED;
        }

        this.x += this.vx;
        this.y += this.vy;

        this.checkCollisions();

        if (!this.isGoalSequence && !currentWorld.isUnderground) {
            // ゴール判定は右端のみ（狭い判定）
            const tRight = getTileAt(this.x + this.hitW - 2, this.y + this.hitH / 2);

            if (tRight === 'F') {
                const poleTx = Math.floor((this.x + this.hitW - 2) / TILE_SIZE);
                const ty = Math.floor((this.y + this.hitH / 2) / TILE_SIZE);

                // 土台部分（下に 'F' がないタイル）はゴール判定をスキップ
                const tileBelow = getTileAt(poleTx * TILE_SIZE, (ty + 1) * TILE_SIZE);
                if (tileBelow !== 'F') {
                    // 通常の移動として継続
                } else {
                    this.isGoalSequence = true;
                    this.facing = 1; // ゴール時は必ず右を向く
                    this.goalPhase = 0;
                    this.goalTimer = 0;
                    this.goalFlagY = 0;
                    this.goalStartY = this.y;
                    this.vx = 0;
                    this.vy = 0;

                    const poleTy = Math.floor((this.y + this.hitH / 2) / TILE_SIZE);
                    let flagScore = 100;
                    if (poleTy <= 4) flagScore = 5000;
                    else if (poleTy <= 6) flagScore = 4000;
                    else if (poleTy <= 8) flagScore = 2000;
                    else if (poleTy <= 10) flagScore = 800;
                    else if (poleTy <= 11) flagScore = 400;
                    addScore(flagScore, this.x, this.y);

                    // ポールに密着させるため、x座標を調整
                    this.x = poleTx * TILE_SIZE - this.hitW / 2;
                    return;
                }
            }
        }

        if (currentWorld.isUnderground && !this.pipeSequence && keys['ArrowRight']) {
            const midY = this.y + this.hitH / 2;
            const ty = Math.floor(midY / TILE_SIZE);
            const tileRight = getTileAt(this.x + this.hitW + 1, midY);

            if ((tileRight === 'h' || tileRight === 'i') && (ty >= 10 && ty <= 11)) {
                // はみ出し防止: マリオの頭（y座標）が土管の天井（Row 10 = 160px）より下にあることを確認
                if (this.y < 10 * TILE_SIZE) return;

                this.pipeSequence = 'entering_right';
                this.pipeTimer = 0;
                audioEngine.playShrinkPipe();
                this.pipeBoundaryX = this.x + this.hitW; // 土管の表面（右端）
                const pipeStartX = 164 * TILE_SIZE;
                const centerX = pipeStartX + (TILE_SIZE * 2 - this.hitW) / 2;
                const destY = 11 * TILE_SIZE; // 地上の出口土管の上面(Row 11: 176)
                this.pipeDest = { worldId: '1-1', x: centerX, y: destY };
                this.vx = 0;
            }
        }

        const levelWidth = currentWorld.map[0].length * TILE_SIZE;
        if (this.x < cameraX) {
            this.x = cameraX;
            this.vx = 0;
        } else if (this.x > levelWidth - this.hitW) {
            this.x = levelWidth - this.hitW;
            this.vx = 0;
        }

        const mapBottom = currentWorld.map.length * TILE_SIZE;
        if (this.y > mapBottom) this.die(true);

        this.updateAnimation();
    }

    checkCollisions() {
        this.isOnGround = false;

        // --- 1. 水平方向の当たり判定 ---
        // Y軸の余裕を少し大きく取り、落下中に床の側面に引っかからないようにする
        const startTy = Math.floor((this.y + 6) / TILE_SIZE);
        const endTy = Math.floor((this.y + this.hitH - 6) / TILE_SIZE);

        if (this.vx > 0) {
            let isColliding = false;
            for (let ty = startTy; ty <= endTy; ty++) {
                if (isSolid(this.x + this.hitW, ty * TILE_SIZE)) { isColliding = true; break; }
            }
            if (isColliding) {
                this.x = Math.floor((this.x + this.hitW) / TILE_SIZE) * TILE_SIZE - this.hitW;
                this.vx = 0;
            }
        } else if (this.vx < 0) {
            let isColliding = false;
            for (let ty = startTy; ty <= endTy; ty++) {
                if (isSolid(this.x, ty * TILE_SIZE)) { isColliding = true; break; }
            }
            if (isColliding) {
                this.x = (Math.floor(this.x / TILE_SIZE) + 1) * TILE_SIZE;
                this.vx = 0;
            }
        }

        // --- 2. 垂直方向の当たり判定 ---
        // 横方向のマージンを取ることで、角に引っかかって上に登れてしまう現象を防止
        const left = this.x + 2;
        const right = this.x + this.hitW - 2;
        const bottom = this.y + this.hitH;

        if (this.vy >= 0) {
            if (isSolid(left, bottom) || isSolid(right, bottom)) {
                this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.hitH;
                this.vy = 0;
                this.isOnGround = true;
                this.stompCount = 0;
            }
        }

        if (this.vy < 0) {
            const h1 = isSolid(left, this.y, true);
            const h2 = isSolid(right, this.y, true);
            const centerTx = Math.floor((this.x + this.hitW / 2) / TILE_SIZE);
            const hCenter = isSolid(centerTx * TILE_SIZE, this.y, true);

            if (h1 || h2 || hCenter) {
                this.y = (Math.floor(this.y / TILE_SIZE) + 1) * TILE_SIZE;
                this.vy = 0;
                // ブロック叩きの処理
                const hitTy = Math.floor(this.y / TILE_SIZE) - 1;
                const tx1 = Math.floor(left / TILE_SIZE);
                const tx2 = Math.floor(right / TILE_SIZE);
                let targetTx = centerTx;
                let hitTile = getTileAt(targetTx * TILE_SIZE, hitTy * TILE_SIZE);
                const isHittable = (t) => t === '?' || t === '#' || t === 'M' || t === 'S' || t === 'C' || t === 'I';

                if (!isHittable(hitTile)) {
                    const tile1 = getTileAt(tx1 * TILE_SIZE, hitTy * TILE_SIZE);
                    const tile2 = getTileAt(tx2 * TILE_SIZE, hitTy * TILE_SIZE);
                    if (isHittable(tile1)) { targetTx = tx1; hitTile = tile1; }
                    else if (isHittable(tile2)) { targetTx = tx2; hitTile = tile2; }
                }
                if (isHittable(hitTile)) hitBlock(targetTx, hitTy, this);
            }
        }
    }

    updateAnimation() {
        if (this.isGoalSequence) {
            if (this.goalPhase === 0) {
                this.animState = 'sliding';
            } else if (this.goalPhase === 1) {
                // フェーズ1: 反転・ジャンプ中
                if (this.goalTimer < 45) {
                    this.animState = 'sliding'; // 反転後もジャンプするまではポールにしがみつく画像
                } else {
                    this.animState = 'jump';
                }
            } else {
                // フェーズ2: 自動歩行中のアニメーションサイクル
                const absVx = Math.abs(this.vx);
                if (absVx > 0.1) {
                    const frameIdx = Math.floor(this.animFrame) % 3;
                    this.animState = `dash${frameIdx + 1}`;
                } else {
                    this.animState = 'neutral';
                }
            }
            return;
        }

        if (this.isDucking) { this.animState = 'duck'; return; }
        if (!this.isOnGround) { this.animState = 'jump'; return; }

        const absVx = Math.abs(this.vx);
        if (((this.vx > 0 && keys['ArrowLeft']) || (this.vx < 0 && keys['ArrowRight'])) && absVx > 0.5) {
            this.animState = 'turn';
            return;
        }

        if (absVx < 0.1) {
            this.animState = 'neutral';
            this.animFrame = 0;
        } else {
            this.animFrame += absVx * 0.2;
            const frameIdx = Math.floor(this.animFrame) % 3;
            this.animState = `dash${frameIdx + 1}`;
        }
    }

    draw(ctx) {
        if (this.isHiddenInCastle) return; // お城の中では描画しない
        if (this.isInvincible && !this.isShrinking && !this.isInvincibleStar && Math.floor(gameFrame / 2) % 2 === 0) return;

        let spriteSet;
        let dW, dH, hH;

        if (this.isTransforming) {
            if (this.transformType === 0) {
                const sizes = [16, 24, 32];
                dW = sizes[this.transformState];
                dH = dW;
                hH = 16;
                spriteSet = (this.transformState === 2) ? assets.superMario : assets.mario;
            } else {
                spriteSet = (Math.floor(this.transformTimer / 3) % 2 === 1) ? assets.fireMario : assets.superMario;
                dW = 32; dH = 32; hH = 32;
            }
        } else if (this.isShrinking) {
            if (this.shrinkType === 1) {
                spriteSet = (Math.floor(this.shrinkTimer / 3) % 2 === 1) ? assets.fireMario : assets.superMario;
                dW = 32; dH = 32; hH = 32;
            } else {
                const sizes = [16, 24, 32];
                dW = sizes[this.shrinkState];
                dH = dW;
                hH = 16;
                spriteSet = (this.shrinkState === 2) ? (this.wasFire ? assets.fireMario : assets.superMario) : assets.mario;
            }
        } else {
            spriteSet = this.isFire ? assets.fireMario : (this.isSuper ? assets.superMario : assets.mario);
            dW = this.drawW;
            dH = this.drawH;
            hH = this.hitH;
        }

        const sprite = spriteSet[this.animState];
        if (!sprite || !sprite.image.complete) return;

        withContext(ctx, () => {
            if (this.pipeSequence === 'entering' || this.pipeSequence === 'exiting') {
                ctx.beginPath();
                ctx.rect(0, 0, WIDTH, Math.round(this.pipeBoundaryY + OFFSET_Y));
                ctx.clip();
            } else if (this.pipeSequence === 'entering_right') {
                ctx.beginPath();
                ctx.rect(0, 0, Math.round(this.pipeBoundaryX - cameraX), HEIGHT);
                ctx.clip();
            }

            if (this.isInvincibleStar) {
                const animIdx = Math.floor(gameFrame / 2) % 4;
                const brightnessValues = [1.4, 1.0, 0.7, 1.0];
                const brightness = brightnessValues[animIdx];
                ctx.filter = `hue-rotate(${gameFrame * 40}deg) brightness(${brightness * 100}%)`;
            }

            const nw = sprite.image.naturalWidth;
            const nh = sprite.image.naturalHeight;

            // ユーザー提供の画像解像度が 512x512 から 26x30 など非常にバラバラであるため、
            // 基準画像(baseNH)の比率計算に頼らず、ゲーム上の状態(dH)に合わせる絶対指定に変更
            let targetDH = dH;

            // しゃがみ等、高さが短くなる特殊状態への対応
            if (this.animState === 'duck' && (this.isSuper || this.isFire)) {
                targetDH = 22;
            } else if (this.animState === 'gameover') {
                targetDH = 16;
            }

            // 画像本来のアスペクト比を用いて描画幅を逆算する
            const targetDW = targetDH * (nw / nh);

            // X座標の中心を計算する（マリオの現在の当たり判定の中心）
            const centerX = this.x - cameraX + (this.hitW / 2);
            // 描画幅の半分を引いて、画像を描画する左端を決定する
            const offsetDrawX = targetDW / 2;

            if (this.facing === -1) {
                ctx.scale(-1, 1);
                // 描画Yの計算: y + hH (地面) - targetDH (スプライト高)
                const drawY = Math.round(this.y + hH - targetDH + OFFSET_Y);
                // 画像を反転した場合はX座標の指定も反転する
                ctx.drawImage(sprite.image, -Math.round(centerX + offsetDrawX), drawY, targetDW, targetDH);
            } else {
                const drawY = Math.round(this.y + hH - targetDH + OFFSET_Y);
                ctx.drawImage(sprite.image, Math.round(centerX - offsetDrawX), drawY, targetDW, targetDH);
            }
        });
    }
}

function getTileAt(x, y) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (ty < 0 || ty >= currentWorld.map.length) return null;
    const row = currentWorld.map[ty];
    if (tx < 0 || tx >= row.length) return null;
    return row[tx];
}

// -- Entity 基底クラス --
// すべてのゲームエンティティの共通プロパティとタイル衝突処理を提供
class Entity {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.vx = 0;
        this.vy = 0;
        this.isOnGround = false;
        this.isDead = false;
    }

    // タイルとの水平衝突判定（壁に当たったら反転）
    checkCollisionX() {
        const side = this.vx > 0 ? this.x + this.w : this.x;
        const top = this.y + 2;
        const bottom = this.y + this.h - 2;
        const t1 = getTileAt(side, top);
        const t2 = getTileAt(side, bottom);

        if (COLLIDABLES.includes(t1) || COLLIDABLES.includes(t2)) {
            this.onWallHit(); // サブクラスでカスタマイズ可能
            if (this.vx > 0) {
                this.x = (Math.floor(this.x / TILE_SIZE) + 1) * TILE_SIZE;
            } else {
                this.x = Math.floor((this.x + this.w) / TILE_SIZE) * TILE_SIZE - this.w;
            }
        }
    }

    // 壁衝突時の挙動（サブクラスでオーバーライド可能）
    onWallHit() {
        this.vx *= -1;
    }

    // 死亡処理（ファイアボール命中時など）
    die(type, direction = 1) {
        if (type === 'fire') {
            addScore(200, this.x, this.y); // ファイアボールで倒した時のスコア
            this.isFlippedDead = true;
            this.vy = -6.0; // 上に大きく跳ねるように変更
            this.vx = direction * 0.5; // 当たった方向に少し飛ぶ
        } else {
            this.isDead = true;
        }
    }

    // タイルとの垂直衝突判定（着地処理）
    checkCollisionY() {
        this.isOnGround = false;
        const left = this.x + 2;
        const right = this.x + this.w - 2;

        if (this.vy >= 0) {
            const bottom = this.y + this.h;
            const t1 = getTileAt(left, bottom);
            const t2 = getTileAt(right, bottom);

            if (COLLIDABLES.includes(t1) || COLLIDABLES.includes(t2)) {
                this.y = Math.floor(bottom / TILE_SIZE) * TILE_SIZE - this.h;
                this.vy = 0;
                this.isOnGround = true;
            }
        }
    }

    // サブクラスで実装すべきメソッド
    update() { /* override */ }
    draw(ctx) { /* override */ }
}

// -- Enemy 中間クラス (extends Entity) --
// 敵キャラ共通の移動・踏みつけ処理のテンプレートを提供
class Enemy extends Entity {
    constructor(x, y, w, h) {
        super(x, y, w, h);
        this.stomped = false;
        this.stompTimer = 0;
        this.STOMP_DURATION = 12; // 30 / 2.4
    }

    // 敵共通の基本更新処理（重力・移動・衝突）
    update() {
        if (this.isDead) return;

        // ひっくり返り落下中の処理
        if (this.isFlippedDead) {
            this.vy += GRAVITY;
            this.x += this.vx;
            this.y += this.vy;
            // 画面外落下判定
            if (this.y > HEIGHT + 32) {
                this.isDead = true;
            }
            return;
        }

        // 画面外の敵は動かさない
        if (!this.isInView()) {
            return;
        }

        // 潰れ状態の処理
        if (this.stomped) {
            this.stompTimer++;
            if (this.stompTimer >= this.STOMP_DURATION) {
                this.onStompComplete(); // サブクラスで踏みつけ完了後の処理を定義
            }
            return;
        }

        // サブクラス固有の更新前処理
        if (this.preUpdate()) return; // trueを返すと以降の処理をスキップ

        // 重力・移動・衝突
        this.vy += GRAVITY;
        this.x += this.vx;
        this.checkCollisionX();
        this.y += this.vy;
        this.checkCollisionY();

        // サブクラス固有の更新後処理
        this.postUpdate();

        // 画面外落下判定
        if (this.y > HEIGHT + 32) {
            this.isDead = true;
        }
    }

    // サブクラスでオーバーライド可能なフック
    preUpdate() { return false; }   // 更新前処理（trueで通常移動をスキップ）
    postUpdate() { }                 // 更新後処理
    onStompComplete() {              // 踏みつけアニメーション完了時
        this.isDead = true;
    }

    // 敵共通のマリオ衝突判定テンプレート
    checkMarioCollision(mario) {
        if (this.isDead || this.stomped || this.isFlippedDead) return;
        if (mario.isDead) return;

        // スター無敵中
        if (mario.isInvincibleStar) {
            if (mario.x < this.x + this.w &&
                mario.x + mario.hitW > this.x &&
                mario.y < this.y + this.h &&
                mario.y + mario.hitH > this.y) {
                this.die('fire', (mario.vx >= 0 ? 1 : -1));
                return;
            }
        }

        const mw = mario.hitW || 16;
        const mh = mario.hitH || 16;

        // AABB衝突判定
        if (mario.x < this.x + this.w &&
            mario.x + mw > this.x &&
            mario.y < this.y + this.h &&
            mario.y + mh > this.y) {

            // 踏みつけ判定
            // 条件: 落下中(vy > 0) または そのフレームですでに踏みつけが発生している場合
            const isFalling = mario.vy >= 0; // > 0 から >= 0 へ緩和
            const alreadyStompedThisFrame = (mario.lastStompFrame === gameFrame);

            // 同一フレーム内の踏みつけ判定をより緩やかにする (h * 0.95 まで許容)
            const threshold = alreadyStompedThisFrame ? 0.95 : 0.75;

            if ((isFalling || alreadyStompedThisFrame) && mario.y + mh < this.y + this.h * threshold) {
                this.onStomp(mario); // サブクラスで踏まれた時の挙動を定義
            } else {
                this.onMarioContact(mario); // サブクラスで横接触時の挙動を定義
            }
        }
    }

    // 踏みつけ時の挙動（サブクラスでオーバーライド）
    onStomp(mario) {
        const comboPoints = [100, 200, 400, 800, 1000, 2000, 4000, 8000, "1UP"];
        const comboIndex = Math.min(mario.stompCount, 8);
        addScore(comboPoints[comboIndex], this.x, this.y);
        audioEngine.playStomp();

        this.stomped = true;
        this.stompTimer = 0;
        this.vx = 0;
        mario.vy = -2.5; // -1.44 -> -2.5 (さらに高く)
        mario.stompCount++;
        mario.lastStompFrame = gameFrame;
    }

    // 横から接触時の挙動（サブクラスでオーバーライド）
    onMarioContact(mario) {
        mario.takeDamage();
    }

    // カメラ範囲内かどうか判定
    isInView() {
        return !(this.x + this.w < cameraX || this.x > cameraX + WIDTH);
    }
}

// -- Goomba Class (extends Enemy) --
class Goomba extends Enemy {
    constructor(x, y) {
        super(x, y, 16, 16);
        this.vx = -0.6; // -0.25 * 2.4
    }

    draw(ctx) {
        if (!this.isInView()) return;

        const drawX = Math.round(this.x - cameraX);
        const drawY = Math.round(this.y + OFFSET_Y);

        // ファイア撃破時（ひっくり返り落下）
        if (this.isFlippedDead) {
            withContext(ctx, () => {
                ctx.translate(drawX + this.w / 2, drawY + this.h / 2);
                ctx.scale(1, -1); // 上下反転
                const sprite = assets.enemies['goomba1']; // アニメーション停止のため固定
                if (sprite && sprite.image.complete) {
                    ctx.drawImage(sprite.image, -this.w / 2, -this.h / 2, this.w, this.h);
                }
            });
            return;
        }

        if (this.stomped) {
            // 潰れ表示
            const flattenH = Math.max(2, Math.round(this.h / 4));
            const flattenY = drawY + (this.h - flattenH);

            const sprite1 = assets.enemies['goomba1'];
            if (sprite1 && sprite1.image && sprite1.image.complete && sprite1.image.naturalWidth !== 0) {
                ctx.drawImage(sprite1.image, drawX, flattenY, this.w, flattenH);
            } else {
                ctx.fillStyle = '#6B3A2A';
                ctx.fillRect(drawX, flattenY, this.w, flattenH);
            }
            return;
        }

        // 通常歩行アニメーション
        const animFrame = Math.floor(gameFrame / 8) % 2; // 15 -> 8 (60FPS対応)
        const imgKey = animFrame === 0 ? 'goomba1' : 'goomba2';
        const sprite = assets.enemies[imgKey];

        if (sprite && sprite.image.complete && sprite.image.naturalWidth !== 0) {
            ctx.drawImage(sprite.image, drawX, drawY, this.w, this.h);
        } else {
            ctx.fillStyle = 'red';
            ctx.fillRect(drawX, drawY, this.w, this.h);
        }
    }
}

// -- Koopa Troopa Class (extends Enemy) --
class Koopa extends Enemy {
    constructor(x, y) {
        super(x, y - 8, 16, 24); // ノコノコは24px高なので上にずらす
        this.vx = -0.6; // -0.25 * 2.4
        this.facing = -1;
        this.STOMP_DURATION = 3; // 8 / 2.4

        // 甲羅状態
        this.isShell = false;
        this.shellMoving = false;
        this.shellTimer = 0;

        // 踏み/蹴り後の無敵フレーム（連続ヒット防止）
        this.hitCooldown = 0;

        // 甲羅復活タイマー設定
        this.SHELL_REVIVE_TIME = 300;   // 復活までのフレーム数（約5秒）
        this.SHELL_BLINK_START = 200;   // 点滅開始フレーム
    }

    // 壁衝突時: 甲羅滑走中はfacingを変えない
    onWallHit() {
        this.vx *= -1;
        if (!this.shellMoving) this.facing *= -1;
    }

    // 更新前フック: 甲羅静止状態の処理
    preUpdate() {
        if (this.hitCooldown > 0) this.hitCooldown--;

        if (this.isShell && !this.shellMoving) {
            this.shellTimer++;

            // 復活判定: 一定時間経過で歩行状態に戻る
            if (this.shellTimer >= this.SHELL_REVIVE_TIME) {
                this.isShell = false;
                this.shellMoving = false;
                this.shellTimer = 0;
                this.h = 24;
                this.y -= 8; // 高さが戻るので位置を上にずらす
                this.vx = -0.6; // -0.25 -> -0.6 (60FPS対応: -0.25 * 2.4)
                this.facing = -1;
                return true;
            }

            this.vy += GRAVITY;
            this.y += this.vy;
            this.checkCollisionY();
            return true; // 通常移動をスキップ
        }
        return false;
    }

    // 更新後フック: 滑る甲羅で他の敵を倒す
    postUpdate() {
        if (this.shellMoving) {
            for (let i = enemies.length - 1; i >= 0; i--) {
                const other = enemies[i];
                if (other === this || other.isDead || other.stomped || other.isFlippedDead) continue; // isFlippedDeadを追加
                if (this.x < other.x + other.w &&
                    this.x + this.w > other.x &&
                    this.y < other.y + other.h &&
                    this.y + this.h > other.y) {

                    // 倒した方向に吹き飛ばす
                    const dir = (this.vx > 0) ? 1 : -1;
                    other.die('fire', dir);
                }
            }
        }
    }

    // 踏みつけアニメーション完了: 甲羅化（消滅しない）
    onStompComplete() {
        this.stomped = false;
        this.isShell = true;
        this.shellMoving = false;
        this.h = 16;
        this.y += 8;
        this.vx = 0;
    }


    // マリオ衝突判定をオーバーライド（甲羅固有のロジック）
    checkMarioCollision(mario) {
        if (this.isDead || this.stomped || this.isFlippedDead) return;
        if (mario.isDead) return;
        if (this.hitCooldown > 0) return;

        // スター無敵中
        if (mario.isInvincibleStar) {
            if (mario.x < this.x + this.w &&
                mario.x + mario.hitW > this.x &&
                mario.y < this.y + this.h &&
                mario.y + mario.hitH > this.y) {
                this.die('fire', (mario.vx >= 0 ? 1 : -1));
                return;
            }
        }

        const mw = mario.hitW || 16;
        const mh = mario.hitH || 16;

        if (mario.x < this.x + this.w &&
            mario.x + mw > this.x &&
            mario.y < this.y + this.h &&
            mario.y + mh > this.y) {

            // 踏みつけ判定の閾値（甲羅は低いので判定を緩める）
            const stompThreshold = (this.isShell || this.shellMoving) ? 0.95 : 0.75;
            const marioCenterY = mario.y + mh / 2;
            const enemyCenterY = this.y + this.h / 2;
            const isAbove = marioCenterY < enemyCenterY;
            const alreadyStompedThisFrame = (mario.lastStompFrame === gameFrame);

            if ((mario.vy >= 0 || alreadyStompedThisFrame) && isAbove && mario.y + mh < this.y + this.h * stompThreshold) {
                // 上から踏んだ場合
                const comboPoints = [100, 200, 400, 800, 1000, 2000, 4000, 8000, "1UP"];
                const comboIndex = Math.min(mario.stompCount, 8);
                addScore(comboPoints[comboIndex], this.x, this.y);

                if (this.shellMoving) {
                    audioEngine.playStomp();
                    this.shellMoving = false;
                    this.vx = 0;
                    this.shellTimer = 0;
                } else if (this.isShell && !this.shellMoving) {
                    audioEngine.playKick();
                    this.shellMoving = true;
                    this.vx = (mario.x + mw / 2 < this.x + this.w / 2) ? 3.0 : -3.0; // 1.0 -> 3.0 (60FPS対応)
                } else {
                    audioEngine.playStomp();
                    this.stomped = true;
                    this.stompTimer = 0;
                    this.vx = 0;
                }
                mario.vy = -2.5;
                mario.stompCount++;
                mario.lastStompFrame = gameFrame;
                this.hitCooldown = 8; // 15 -> 8 (連続踏みを可能にするため)
            } else if (this.isShell && !this.shellMoving) {
                // 静止甲羅に横から触れた → 蹴り飛ばす
                const comboPoints = [100, 200, 400, 800, 1000, 2000, 4000, 8000, "1UP"];
                const comboIndex = Math.min(mario.stompCount, 8);
                audioEngine.playKick();
                this.shellMoving = true;
                this.vx = (mario.x + mw / 2 < this.x + this.w / 2) ? 3.0 : -3.0; // 1.0 -> 3.0 (60FPS対応)
                mario.vy = -2.5; // -0.6 -> -2.5 (60FPS対応 & さらに高く)
                mario.stompCount++;
                mario.lastStompFrame = gameFrame;
                this.hitCooldown = 15;
            } else {
                mario.takeDamage();
            }
        }
    }

    draw(ctx) {
        if (!this.isInView()) return;
        const drawX = Math.round(this.x - cameraX);
        const drawY = Math.round(this.y + OFFSET_Y);

        // ファイア撃破・甲羅撃破時（ひっくり返り落下）
        if (this.isFlippedDead) {
            withContext(ctx, () => {
                ctx.translate(drawX + this.w / 2, drawY + this.h / 2);
                ctx.scale(1, -1); // 上下反転
                this._drawShell(ctx, -this.w / 2, -this.h / 2, this.w, this.h);
            });
            return;
        }

        if (this.stomped) {
            const flattenH = Math.max(4, Math.round(this.h / 3));
            const flattenY = drawY + (this.h - flattenH);
            this._drawShell(ctx, drawX, flattenY, this.w, flattenH);
            return;
        }
        if (this.isShell) {
            this._drawShell(ctx, drawX, drawY, this.w, this.h);
            return;
        }
        this._drawWalking(ctx, drawX, drawY);
    }

    _drawShell(ctx, x, y, w, h) {
        // 復活直前はkame4(足あり)とkame5(足なし)を交互に点滅
        let spriteKey = 'koopaShell'; // デフォルト: kame5（足なし）
        if (this.isShell && !this.shellMoving && this.shellTimer > this.SHELL_BLINK_START) {
            // 点滅: 4フレームごとに切り替え
            const blinkFrame = Math.floor(this.shellTimer / 4) % 2; // 8 -> 4 (60FPS対応)
            spriteKey = blinkFrame === 0 ? 'koopaShell' : 'koopaShellLegs';
        }
        const sprite = assets.enemies[spriteKey];
        if (sprite && sprite.image.complete && sprite.image.naturalWidth !== 0) {
            ctx.drawImage(sprite.image, x, y, w, h);
        } else {
            ctx.fillStyle = '#00A800';
            ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        }
    }

    _drawWalking(ctx, x, y) {
        // isFlippedDeadの描画はdrawメソッドで処理されるため、ここでは通常歩行のみ
        const animFrame = Math.floor(gameFrame / 8) % 2; // 15 -> 8 (60FPS対応)
        const imgKey = animFrame === 0 ? 'koopa1' : 'koopa2';
        const sprite = assets.enemies[imgKey];

        if (sprite && sprite.image.complete && sprite.image.naturalWidth !== 0) {
            withContext(ctx, () => {
                if (this.facing === 1) {
                    ctx.scale(-1, 1);
                    ctx.drawImage(sprite.image, -(x + this.w), y, this.w, this.h);
                } else {
                    ctx.drawImage(sprite.image, x, y, this.w, this.h);
                }
            });
        } else {
            ctx.fillStyle = '#00A800';
            ctx.fillRect(x + 1, y + 1, this.w - 2, this.h - 2);
        }
    }
}

const BG_DECOR_1_1 = [
    //01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                    c                C                              c                C                              c                C                               c                C                             ",
    "        c                   v                 c                             v                            c                  v                            c                   v                            c         ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    ",
    "M          t    m      g                  G     M           t   m       g                 G      M          t   m        g               t      M              g m       g                       M            g m   ",
    "                                                                                                                                                                                                                    ",
    "                                                                                                                                                                                                                    "
];

// -- Map Data --
const LEVEL_1_1 = [
    //01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
    "                                                                                                                                                                                                                     ",
    "                                                                                                                                                                                                                     ",
    "                                                                                                                                                                                                                     ",
    "                                                                                                                                                                                                       F             ",
    "                      ?                                                           K K                                                                                                                  F             ",
    "                                                                                ########   ###?              M           ###    #??#                                                         OO        F             ",
    "                                                                                                                                                                                            OOO        F             ",
    "                                                                                                                                                                                           OOOO        F             ",
    "                                                                I                                                                                                                         OOOOO        F             ",
    "                ?   #M#?#                     []         []                  #M#              C     #S    ?  ?  ?     #          ##      O  O          OO   O            ##?#            OOOOOO        F             ",
    "                                      []      {}         {}                                                                             OO  OO        OOO   OO                          OOOOOOO        F             ",
    "                            []        {}      {}         {}                                                                            OOO  OOO      OOOO   OOO     []              [] OOOOOOOO        F             ",
    "                    K       {}        {}   K  {}    K K  {}                                    K K       N        K K     K K    K K  OOOO  OOOO    OOOOO   OOOO    {}         K K  {}OOOOOOOOO        F             ",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG  GGGGGGGGGGGGGGG   GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG   GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG  GGGGGGGGGGGGGGG   GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG   GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
];

const LEVEL_1_1_UNDER = [
    "                ",
    "u   uuuuuuu    {",
    "u              {",
    "u              {",
    "u    ccccc     {",
    "u              {",
    "u   ccccccc    {",
    "u              {",
    "u   ccccccc    {",
    "u   uuuuuuu    {",
    "u   uuuuuuu  hjk",
    "u   uuuuuuu  ilm",
    "gggggggggggggggg",
    "gggggggggggggggg",
];

// 文字記号を実際のタイルIDに変換するマッピング（地下用）
const UNDER_TILE_MAP = {
    'g': 'extra_g', // 地面 (block(under)3)
    'b': 'extra_b', // 壁 (block(under)2) - LEVEL_1_1_UNDER の左端に使用
    'u': 'extra_u', // 天井 (block(under)1)
    'h': 'h',
    'i': 'i',
    'j': 'j',
    'k': 'k',
    'l': 'l',
    'm': 'm'
};

// -- World Context --
let currentWorld = {
    map: [...LEVEL_1_1],
    bgDecor: [...BG_DECOR_1_1],
    bg: '#9288FF',
    isUnderground: false,
    id: '1-1'
};

function switchWorld(worldId, startX, startY) {
    if (worldId === '1-1_under') {
        // 地下へ
        currentWorld = {
            map: [...LEVEL_1_1_UNDER],
            bgDecor: null, // 地下には装飾なし
            bg: '#000000',
            isUnderground: true,
            id: '1-1_under'
        };
    } else {
        // 地上へ
        currentWorld = {
            map: [...LEVEL_1_1],
            bgDecor: [...BG_DECOR_1_1],
            bg: '#9288FF',
            isUnderground: false,
            id: '1-1'
        };
    }
    if (worldId === '1-1_under') {
        // 地下の土管入口（x=2列目から[と]が並ぶ）の中央に補正
        const pipeStartX = 2 * TILE_SIZE;
        mario.x = pipeStartX + (TILE_SIZE * 2 - mario.hitW) / 2;
        mario.y = -32; // 画面外上から落下
    } else {
        mario.x = startX;
        mario.y = startY;
    }
    mario.vx = 0;
    mario.vy = 0;

    // マップの高さに合わせて OFFSET_Y を再計算
    OFFSET_Y = HEIGHT - (currentWorld.map.length * TILE_SIZE);

    if (currentWorld.isUnderground) {
        cameraX = 0;
    } else {
        cameraX = Math.max(0, mario.x - WIDTH / 2);
    }

    // 落下入場の処理: pipeSequence をスキップする
    if (worldId === '1-1_under' && mario.y <= 0) {
        mario.pipeSequence = null;
    }

    // 敵とアイテムのリセット
    enemies.length = 0;
    items.length = 0;
    projectiles.length = 0;
    loadEnemies();
    // 状態のリセット（必要に応じて）
    blockStates = {};
    coinEffects = [];
    brickParticles = [];
}

function resetGame() {
    currentScore = 0;
    collectedCoins = 0;
    livesRemaining = 3;
    hasReachedCheckpoint = false;
    resetLevel('1-1', true);
}

function resetLevel(worldId, resetPlayerPowerUp = true, useCheckpoint = false) {
    if (currentGameState === STATE_GAMEOVER) {
        hasReachedCheckpoint = false;
    }
    window.isTimeUp = false; // タイムアップフラグをクリア
    levelTimer = 400;
    timerFrameCount = 0;

    // 清掃 (switchWorld 内でクリアされるもの以外)
    scoreEffects.length = 0;

    // マリオの状態を初期化
    mario.isDead = false;
    mario.deathTimer = 0;
    mario.deathPhase = 0;
    mario.isGoalSequence = false;
    mario.goalPhase = 0;
    mario.goalTimer = 0;
    mario.goalFlagY = 0;
    mario.isHiddenInCastle = false;
    mario.isCastleFlagRising = false;
    mario.castleFlagY = 0;
    mario.pipeSequence = null;
    mario.isTransforming = false;
    mario.isShrinking = false;
    mario.isInvincible = false;
    mario.invincibilityTimer = 0;
    mario.isInvincibleStar = false;
    mario.starTimer = 0;
    mario.isDucking = false;
    mario.stompCount = 0;
    mario.vx = 0;
    mario.vy = 0;
    mario.animState = 'neutral';

    if (resetPlayerPowerUp) {
        mario.isSuper = false;
        mario.isFire = false;
        mario.hitW = 14;
        mario.hitH = 16;
        mario.drawW = 16;
        mario.drawH = 16;
    }

    // 開始位置の決定 (中間ポイント対応)
    let startX = 32;
    let startY = 192;
    let targetCameraX = 0;

    if (useCheckpoint && hasReachedCheckpoint && worldId === '1-1') {
        startX = 83 * TILE_SIZE;
        // 地面に設置するように調整
        startY = 192;
        // マリオが開始時と同じように左端にいるようにスクロール
        targetCameraX = startX - 32;
    }

    // ワールド切り替え（内部で enemies, items, blockStates, etc. がリセットされる）
    // スーパーマリオの場合、Y座標を16px上にずらして地面に埋まらないようにする
    if (mario.isSuper || mario.isFire) {
        startY -= 16;
    }
    switchWorld(worldId, startX, startY);

    // カメラ位置の上書き (switchWorld内で設定される値を必要に応じて上書きする)
    cameraX = targetCameraX;
}

// 注：上記のマップは簡易的な再現です。本来はもっと長く、配置も複雑ですが、まずはスクロールの確認用として構成しました。

// -- Instances --
const mario = new Mario(32, 192);
const enemies = [];
const items = [];

// マップから敵を読み込む
function loadEnemies() {
    for (let y = 0; y < currentWorld.map.length; y++) {
        let row = currentWorld.map[y];
        let newRow = "";
        for (let x = 0; x < row.length; x++) {
            const char = row[x];
            if (char === 'K') {
                enemies.push(new Goomba(x * TILE_SIZE, y * TILE_SIZE));
                newRow += " ";
            } else if (char === 'N') {
                enemies.push(new Koopa(x * TILE_SIZE, y * TILE_SIZE));
                newRow += " ";
            } else if (char === 'c') {
                items.push(new Coin(x * TILE_SIZE, y * TILE_SIZE));
                newRow += " ";
            } else {
                newRow += char;
            }
        }
        currentWorld.map[y] = newRow;
    }
}


// -- Input Handling --
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;

    if (currentGameState === STATE_TITLE) {
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
            titleSelection = titleSelection === 0 ? 1 : 0;
        }
        if (e.code === 'Enter') {
            resetGame(); // ゲーム全体を初期化して開始
            currentGameState = STATE_LOADING;
            loadingTimer = 0;
            loadingBlackFrames = 0;
        }
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

/**
 * ゲームループ (60FPS固定版)
 */
let lastTime = 0;
const FPS = 60;
const frameDuration = 1000 / FPS;

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;

    if (deltaTime >= frameDuration) {
        // 蓄積された時間を消費して更新
        lastTime = timestamp - (deltaTime % frameDuration);

        disableSmoothing(ctx);

        if (currentGameState === STATE_TITLE) {
            drawTitleScreen(ctx);
            drawHUD(ctx);
        } else if (currentGameState === STATE_LOADING) {
            if (loadingTimer < 180) { // 3秒 (60FPS * 3)
                drawLoadingScreen(ctx);
                drawHUD(ctx); // LOADING画面でもHUDを表示
                loadingTimer++;
            } else {
                // 0.2秒 (60FPS * 0.2 = 12フレーム) の真っ黒な画面
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, WIDTH, HEIGHT);
                loadingBlackFrames++;
                if (loadingBlackFrames >= 12) {
                    currentGameState = STATE_PLAYING;
                    audioEngine.playBGM();
                    console.log("State transition: LOADING -> PLAYING");
                }
            }
        } else if (currentGameState === STATE_GAMEOVER) {
            // ゲームオーバー画面: 真っ暗な背景にHUDのみ
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
            drawHUD(ctx);

            // TIME UP経由の場合は前半 TIME UP、後半 GAME OVERの約6秒(360flame)
            if (!window.gameOverTimer) window.gameOverTimer = 0;
            window.gameOverTimer++;

            const maxTimer = window.isTimeUp ? 360 : 180;
            if (window.gameOverTimer > maxTimer) {
                window.gameOverTimer = 0;
                window.isTimeUp = false; // フラグリセット

                // 全てリセットしてタイトルへ
                resetGame();
                currentGameState = STATE_TITLE;
                audioEngine.stopBGM();
            }
        } else if (currentGameState === STATE_PLAYING) {
            // -- 以下、従来のループ処理 --
            drawWorld(ctx);

            // 4. マリオ更新・描画
            if (mario.isDead) { // mario.isDead is still used inside the sprite class
                mario.updateDeath();
                for (let i = enemies.length - 1; i >= 0; i--) {
                    const enemy = enemies[i];
                    if (!enemy.isDead) enemy.draw(ctx);
                }
            } else if (mario.isTransforming || mario.isShrinking) {
                if (mario.isTransforming) mario.updateTransform();
                else if (mario.isShrinking) mario.updateShrink();

                for (let i = enemies.length - 1; i >= 0; i--) {
                    const enemy = enemies[i];
                    if (!enemy.isDead) enemy.draw(ctx);
                }
                for (let i = items.length - 1; i >= 0; i--) {
                    const item = items[i];
                    if (!item.isDead) item.draw(ctx);
                }
            } else {
                mario.update();
                updateBlockStates();
                updateCoinEffects();
                updateBrickParticles();
                updateScoreEffects();

                // カメラ更新 (マリオを中心に右方向へのみ移動, 地上のみスクロール)
                if (!currentWorld.isUnderground) {
                    if (mario.x > WIDTH / 2) {
                        const newCameraX = mario.x - WIDTH / 2;
                        if (newCameraX > cameraX) cameraX = newCameraX;
                    }
                }
                // マップ端制限
                const maxCameraX = (currentWorld.map[0].length * TILE_SIZE) - WIDTH;
                if (cameraX > maxCameraX) cameraX = maxCameraX;

                for (let i = enemies.length - 1; i >= 0; i--) {
                    const enemy = enemies[i];
                    enemy.update();
                    enemy.checkMarioCollision(mario);
                    if (!enemy.isDead && !enemy.stomped && !enemy.isFlippedDead) {
                        for (let j = i - 1; j >= 0; j--) {
                            const other = enemies[j];
                            if (other.isDead || other.stomped || other.isFlippedDead) continue;
                            if (enemy.x < other.x + other.w &&
                                enemy.x + enemy.w > other.x &&
                                enemy.y < other.y + other.h &&
                                enemy.y + enemy.h > other.y) {
                                const k1 = (enemy instanceof Koopa && enemy.shellMoving);
                                const k2 = (other instanceof Koopa && other.shellMoving);
                                if (k1 || k2) {
                                    if (k1) other.die('fire', (enemy.vx > 0 ? 1 : -1));
                                    if (k2) enemy.die('fire', (other.vx > 0 ? 1 : -1));
                                }
                            }
                        }
                    }
                    if (enemy.isDead) enemies.splice(i, 1);
                    else enemy.draw(ctx);
                }

                for (let i = items.length - 1; i >= 0; i--) {
                    const item = items[i];
                    item.update();
                    item.checkMarioCollision(mario);
                    if (item.isDead) items.splice(i, 1);
                    else item.draw(ctx);
                }
            }

            mario.draw(ctx);

            // 土管遷移中の前面描画補正
            if (mario.pipeSequence) {
                const tx = Math.floor(mario.x / TILE_SIZE);
                const ty = Math.floor(mario.y / TILE_SIZE);
                // マリオ周辺のタイルをチェックして、土管があれば上に重ねて描画する
                for (let dy = -1; dy <= 2; dy++) {
                    for (let dx = -1; dx <= 2; dx++) {
                        const curX = tx + dx;
                        const curY = ty + dy;
                        if (curY >= 0 && curY < currentWorld.map.length && curX >= 0 && curX < currentWorld.map[curY].length) {
                            const char = currentWorld.map[curY][curX];
                            if (['[', ']', '{', '}', 'h', 'i', 'j', 'k', 'l', 'm'].includes(char)) {
                                drawTile(ctx, char, curX * TILE_SIZE - cameraX, curY * TILE_SIZE + OFFSET_Y, curX, curY);
                            }
                        }
                    }
                }
            }

            if (!mario.isDead && !mario.isTransforming && !mario.isShrinking) {
                for (let i = projectiles.length - 1; i >= 0; i--) {
                    const p = projectiles[i];
                    p.update();
                    if (p.isDead) projectiles.splice(i, 1);
                    else p.draw(ctx);
                }
            }

            drawCoinEffects(ctx);
            drawBrickParticles(ctx);
            drawScoreEffects(ctx);

            updateGameSystem();
            drawHUD(ctx);
        }
        gameFrame++;
    }
    requestAnimationFrame(loop);
}


// アセットをロードしてから開始
loadAssets().then(() => {
    try {
        buildTileCaches(); // タイルをオフスクリーンキャンバスにキャッシュ
    } catch (e) {
        console.error("buildTileCaches error:", e);
    }
    try {
        loadEnemies();
    } catch (e) {
        console.error("loadEnemies error:", e);
    }
    console.log("Assets loaded. Starting loop with gameState:", currentGameState);
    requestAnimationFrame(loop);
}).catch(e => {
    console.error("loadAssets promise error:", e);
});

