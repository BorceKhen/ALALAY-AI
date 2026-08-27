// ============================================================
// telemetry.js — Interaction Data Collector
// Captures HCI variables for cognitive load and confusion metrics
// ============================================================

(function() {
    // Global tracker object
    window.TelemetryTracker = {
        deckName: '',
        sessionType: '', // 'flashcard' or 'quiz'
        
        // Metrics
        readingDuration: 0,
        idleTime: 0,
        deadClicks: 0,
        scrollVelocityMax: 0,
        scrollVelocityAvg: 0,
        regressionScrolls: 0,
        magnificationCount: 0,
        
        // Audio/TTS Metrics
        ttsPlaybackRate: 1.0,
        ttsReplays: 0,
        ttsPauses: 0,
        
        // Performance
        quizScore: null,
        lessonCompletion: 0,

        // Internal tracking states
        _isActive: false,
        _startTime: null,
        _lastActiveTime: null,
        _idleIntervalId: null,
        
        // Scroll tracking
        _lastScrollY: 0,
        _lastScrollTime: 0,
        _scrollVelocities: [],
        _maxScrollDepth: 0,
        _scrollDirections: [], // track scroll direction history to count regressions
        
        // Magnification tracking
        _lastWidth: window.innerWidth,

        init: function(deckName, sessionType) {
            if (this._isActive) return;
            this.deckName = deckName;
            this.sessionType = sessionType;
            this._isActive = true;
            this._startTime = Date.now();
            this._lastActiveTime = Date.now();
            this._lastScrollY = window.scrollY;
            this._lastScrollTime = Date.now();

            // Set up timers
            this._idleIntervalId = setInterval(() => this._checkIdle(), 1000);

            // Register event listeners
            this._registerListeners();
            console.log(`[Telemetry] Tracking initialized for deck: "${deckName}", session: "${sessionType}"`);
        },

        _registerListeners: function() {
            // Activity listeners (for idle time calculation)
            const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
            activityEvents.forEach(evt => {
                window.addEventListener(evt, () => this._recordActivity(), { passive: true });
            });

            // Click listener for dead clicks
            document.addEventListener('click', (e) => this._checkDeadClick(e));

            // Scroll listener for velocity and regression scrolls
            window.addEventListener('scroll', () => this._trackScroll(), { passive: true });

            // Zoom/magnification detector
            window.addEventListener('resize', () => this._trackMagnification(), { passive: true });

            // Automatically send payload on exit
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.save();
                }
            });
            window.addEventListener('pagehide', () => this.save());
        },

        _recordActivity: function() {
            this._lastActiveTime = Date.now();
        },

        _checkIdle: function() {
            if (!this._isActive) return;
            
            // Increment total reading duration
            this.readingDuration = Math.floor((Date.now() - this._startTime) / 1000);

            // If inactive for > 3 seconds, start counting idle time
            const secondsInactive = (Date.now() - this._lastActiveTime) / 1000;
            if (secondsInactive > 3) {
                this.idleTime++;
            }
        },

        _checkDeadClick: function(e) {
            if (!this._isActive) return;

            // Check if click was on interactive element
            let target = e.target;
            let isInteractive = false;

            while (target && target !== document.body) {
                const tag = target.tagName;
                const style = window.getComputedStyle(target);
                
                if (
                    ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(tag) ||
                    target.onclick ||
                    target.hasAttribute('role') ||
                    style.cursor === 'pointer' ||
                    target.classList.contains('card') ||
                    target.classList.contains('import-card') ||
                    target.classList.contains('access-card') ||
                    target.classList.contains('btn-quiz-option')
                ) {
                    isInteractive = true;
                    break;
                }
                target = target.parentElement;
            }

            if (!isInteractive) {
                this.deadClicks++;
                console.log(`[Telemetry] Dead click detected! Total: ${this.deadClicks}`);
            }
        },

        _trackScroll: function() {
            if (!this._isActive) return;

            const currentScrollY = window.scrollY;
            const currentTime = Date.now();
            
            const distance = Math.abs(currentScrollY - this._lastScrollY);
            const timeDiff = (currentTime - this._lastScrollTime) / 1000; // in seconds

            if (distance > 0 && timeDiff > 0) {
                const velocity = distance / timeDiff;
                this._scrollVelocities.push(velocity);
                
                // Track peak scroll velocity
                if (velocity > this.scrollVelocityMax) {
                    this.scrollVelocityMax = velocity;
                }
                
                // Track regression scrolls (scrolling UP by > 50px after scrolling down)
                const direction = currentScrollY < this._lastScrollY ? 'UP' : 'DOWN';
                const lastDirection = this._scrollDirections[this._scrollDirections.length - 1];

                if (direction === 'UP' && lastDirection === 'DOWN' && distance > 50) {
                    this.regressionScrolls++;
                    console.log(`[Telemetry] Regression scroll detected! Total: ${this.regressionScrolls}`);
                }

                if (!lastDirection || lastDirection !== direction) {
                    this._scrollDirections.push(direction);
                    if (this._scrollDirections.length > 10) {
                        this._scrollDirections.shift(); // keep history short
                    }
                }
            }

            this._lastScrollY = currentScrollY;
            this._lastScrollTime = currentTime;

            // Track page scroll depth to compute completion rate
            const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (totalHeight > 0) {
                const scrollPercentage = (currentScrollY / totalHeight) * 100;
                if (scrollPercentage > this._maxScrollDepth) {
                    this._maxScrollDepth = scrollPercentage;
                    
                    // Update lesson completion rate in flashcard views
                    if (this.sessionType === 'flashcard') {
                        this.lessonCompletion = Math.min(100, Math.round(this._maxScrollDepth));
                    }
                }
            }
        },

        _trackMagnification: function() {
            if (!this._isActive) return;
            
            // Browser zoom changes window.innerWidth but triggers layout reflows
            // Count window width change transitions
            if (window.innerWidth !== this._lastWidth) {
                this.magnificationCount++;
                this._lastWidth = window.innerWidth;
                console.log(`[Telemetry] Screen resized/magnified! Total frequency: ${this.magnificationCount}`);
            }
        },

        // Audio Hooks (TTS)
        trackTTSPlay: function() {
            // Intended to be called when audio starts playing
        },
        
        trackTTSPause: function() {
            this.ttsPauses++;
            console.log(`[Telemetry] TTS Paused. Total pauses: ${this.ttsPauses}`);
        },

        trackTTSReplay: function() {
            this.ttsReplays++;
            console.log(`[Telemetry] TTS Replayed. Total replays: ${this.ttsReplays}`);
        },

        setTTSPlaybackRate: function(rate) {
            this.ttsPlaybackRate = parseFloat(rate);
            console.log(`[Telemetry] TTS Playback Rate changed to: ${this.ttsPlaybackRate}`);
        },

        // Complete lesson / update completion rate manually
        setLessonCompletion: function(percentage) {
            this.lessonCompletion = Math.min(100, Math.max(0, percentage));
        },

        // Complete quiz / set score
        setQuizScore: function(percentage) {
            this.quizScore = parseFloat(percentage);
        },

        // Generate JSON payload
        getPayload: function() {
            // Compute average scroll velocity
            let avgVel = 0;
            if (this._scrollVelocities.length > 0) {
                const sum = this._scrollVelocities.reduce((a, b) => a + b, 0);
                avgVel = sum / this._scrollVelocities.length;
            }
            this.scrollVelocityAvg = avgVel;

            const isTouch = navigator.maxTouchPoints > 0 || window.matchMedia("(max-width: 768px)").matches;
            const deviceType = isTouch ? 'Mobile' : 'Desktop';

            // Feature usage summary
            const userId = document.body.getAttribute('data-user-id') || '';
            const getStorageKey = (key) => userId ? `${userId}_${key}` : key;

            const features = {
                auto_scroll: parseInt(localStorage.getItem(getStorageKey('access_auto_scroll')) || '0'),
                screen_reader: parseInt(localStorage.getItem(getStorageKey('access_screen_reader')) || '0'),
                tts: parseInt(localStorage.getItem(getStorageKey('access_tts')) || '0'),
                line_focus: parseInt(localStorage.getItem(getStorageKey('access_line_focus')) || '0'),
                color_filter: localStorage.getItem(getStorageKey('daltonizeFilter')) || 'none'
            };

            return {
                deck_name: this.deckName,
                session_type: this.sessionType,
                active_device_type: deviceType,
                accessibility_feature_usage: features,
                reading_duration_seconds: this.readingDuration,
                screen_magnification_frequency: this.magnificationCount,
                dead_clicks: this.deadClicks,
                scroll_velocity_px_sec: Math.round(this.scrollVelocityAvg * 100) / 100,
                regression_scroll_count: this.regressionScrolls,
                idle_time_seconds: this.idleTime,
                tts_playback_rate: this.ttsPlaybackRate,
                tts_replay_count: this.ttsReplays,
                tts_pause_frequency: this.ttsPauses,
                quiz_score_percentage: this.quizScore,
                lesson_completion_rate: this.lessonCompletion
            };
        },

        // Send telemetry payload to backend
        save: function() {
            if (!this._isActive) return;
            
            const payload = this.getPayload();
            const url = '/api/telemetry/log';
            const dataStr = JSON.stringify(payload);

            console.log('[Telemetry] Saving log session payload:', payload);

            // Use sendBeacon for reliable delivery on page exit
            if (navigator.sendBeacon) {
                const blob = new Blob([dataStr], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            } else {
                // Fallback for older browsers
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: dataStr,
                    keepalive: true
                }).catch(err => console.error('[Telemetry] Save failed:', err));
            }

            // Deactivate to avoid duplicate logging
            this._isActive = false;
            if (this._idleIntervalId) {
                clearInterval(this._idleIntervalId);
            }
        }
    };
})();
