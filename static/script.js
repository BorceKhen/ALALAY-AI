// ============================================================
// script.js — Frontend ↔ Backend bridge
// All DOM event listeners and fetch calls live here.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    const userId = document.body.getAttribute('data-user-id') || '';
    const getStorageKey = (key) => userId ? `${userId}_${key}` : key;

    const page = document.body.getAttribute('data-page') || '';
    if (page === 'auth') {
        sessionStorage.removeItem("silence_ai_recommendations");
        sessionStorage.removeItem("ignored_ai_recommendation");
    }

    // ── One-Time Page-Load Sync from Database to LocalStorage ──
    function syncDatabaseToLocalStorage() {
        const syncField = (key, defaultAttr) => {
            const fullKey = getStorageKey(key);
            const attrVal = document.body.getAttribute(defaultAttr);
            if (attrVal !== null && attrVal !== undefined && attrVal !== "") {
                const val = (attrVal === 'on' || attrVal === 'true' || attrVal === '1') ? '1' : (attrVal === 'off' || attrVal === 'false' || attrVal === '0' ? '0' : attrVal);
                localStorage.setItem(fullKey, val);
            }
        };

        syncField('textSize', 'data-text-size');
        syncField('access_line_focus', 'data-line-focus');
        syncField('access_auto_scroll', 'data-auto-scroll');
        syncField('access_screen_reader', 'data-screen-reader');
        syncField('access_tts', 'data-tts');
        syncField('access_hotkeys', 'data-hotkeys');
        syncField('access_hotkey_map', 'data-hotkey-map');
        syncField('daltonizeFilter', 'data-color-filter');
        syncField('contrastTheme', 'data-contrast-theme');
        syncField('dyslexiaFont', 'data-dyslexia-font');
        syncField('letterSpacing', 'data-letter-spacing');
        syncField('lineSpacing', 'data-line-spacing');
        syncField('ttsPlaybackRate', 'data-tts-rate');
        syncField('contentLevel', 'data-content-level');
        syncField('ruler_thickness', 'data-ruler-thickness');
        syncField('ruler_length', 'data-ruler-length');
        syncField('magnetic_ruler', 'data-magnetic-ruler');
        syncField('ttsVoice', 'data-tts-voice');
        syncField('ttsEngine', 'data-tts-engine');
        syncField('fontStyle', 'data-font-style');
    }

    // Sync LocalStorage settings back to body attributes to ensure consistent frontend state
    function syncLocalStorageToBody() {
        const applyAttr = (key, attrName, mapping) => {
            const val = localStorage.getItem(getStorageKey(key));
            if (val !== null) {
                const mappedVal = typeof mapping === 'function' ? mapping(val) : val;
                document.body.setAttribute(attrName, mappedVal);
            }
        };

        applyAttr('access_screen_reader', 'data-screen-reader', (val) => val === '1' ? 'on' : 'off');
        applyAttr('access_tts', 'data-tts', (val) => val === '1' ? 'on' : 'off');
        applyAttr('access_line_focus', 'data-line-focus', (val) => val === '1' ? 'on' : 'off');
        applyAttr('access_auto_scroll', 'data-auto-scroll', (val) => val === '1' ? 'on' : 'off');
        applyAttr('access_hotkeys', 'data-hotkeys', (val) => val === '0' ? 'off' : 'on');
        applyAttr('access_hotkey_map', 'data-hotkey-map');
        applyAttr('daltonizeFilter', 'data-color-filter', (val) => val || 'none');
        applyAttr('ttsPlaybackRate', 'data-tts-rate', (val) => val || '1.0');
        applyAttr('contentLevel', 'data-content-level', (val) => val || 'medium');
        applyAttr('ruler_thickness', 'data-ruler-thickness', (val) => val || 'medium');
        applyAttr('ruler_length', 'data-ruler-length', (val) => val || 'full');
        applyAttr('magnetic_ruler', 'data-magnetic-ruler', (val) => val === '1' ? 'on' : 'off');
        applyAttr('ttsVoice', 'data-tts-voice', (val) => val || 'en-US-AvaNeural');
        applyAttr('ttsEngine', 'data-tts-engine', (val) => val || 'azure');
        applyAttr('fontStyle', 'data-font-style', (val) => val || 'default');
    }

    // Run the page-load synchronization once immediately
    syncDatabaseToLocalStorage();
    syncLocalStorageToBody();

    // Dynamically show or hide all TTS triggers, Auto Play buttons, and quiz buttons based on active TTS setting
    function applyTtsVisibility() {
        const isTtsOn = document.body.getAttribute('data-tts') === 'on' || localStorage.getItem(getStorageKey('access_tts')) === '1';
        const ttsElements = document.querySelectorAll('.tts-trigger, #btn-autoplay-tts, #btn-autoplay-tts-floating, .btn-autoplay-tts, #btn-quiz-tts');
        ttsElements.forEach(el => {
            if (isTtsOn) {
                el.style.removeProperty('display');
                if (el.id === 'btn-autoplay-tts') {
                    el.classList.add('d-flex');
                    el.classList.remove('d-none');
                }
            } else {
                el.style.setProperty('display', 'none', 'important');
                el.classList.remove('d-flex');
                el.classList.add('d-none');
            }
        });
    }
    // ── Screen Reader Active State & Immediate Speech Dispatcher ──
    window.isScreenReaderActive = function() {
        const key = getStorageKey('access_screen_reader');
        const stored = localStorage.getItem(key);
        const bodyAttr = document.body.getAttribute('data-screen-reader');
        const htmlAttr = document.documentElement.getAttribute('data-screen-reader');
        return stored === '1' || bodyAttr === 'on' || htmlAttr === 'on';
    };

    let screenReaderTimer = null;
    window.speakScreenReader = function(text) {
        if (!window.isScreenReaderActive() || !window.speechSynthesis) return;
        if (!text || !text.trim()) return;

        if (screenReaderTimer) {
            clearTimeout(screenReaderTimer);
            screenReaderTimer = null;
        }

        // Clean up text & expand abbreviations
        const cleaned = text
            .replace(/switch\s*tts/gi, 'Text-to-Speech button')
            .replace(/\bswitch\b/gi, 'button')
            .replace(/\btts\b/gi, 'Text-to-Speech')
            .replace(/\b(down|up|left|right)\s+arrow(s?)\b/gi, (match, direction, plural) => {
                const isCapital = direction[0] === direction[0].toUpperCase();
                const btnWord = plural ? "buttons" : "button";
                return (isCapital ? direction : direction.toLowerCase()) + " " + btnWord;
            })
            .replace(/\b(arrow)(s?)\b/gi, (match, p1, p2) => {
                const isCapital = p1[0] === 'A';
                return (isCapital ? 'Ar-row' : 'ar-row') + p2;
            })
            .replace(/\s+/g, ' ')
            .trim();

        try {
            window.speechSynthesis.cancel();
            if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        } catch (e) {
            console.warn("[ScreenReader Cancel Error]", e);
        }

        const utterance = new SpeechSynthesisUtterance(cleaned);
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(localStorage.getItem(getStorageKey('ttsPlaybackRate'))) || 1.0;

        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
            const chosen = voices.find(v => v.name.includes('Zira') || (v.lang === 'en-US' && !v.name.includes('David')))
                        || voices.find(v => v.lang.startsWith('en-US'))
                        || voices.find(v => v.lang.startsWith('en'))
                        || voices[0];
            if (chosen) utterance.voice = chosen;
        }

        utterance.onend = () => {};
        utterance.onerror = (err) => {
            console.warn("[ScreenReader Speech Error]", err);
        };

        // Micro-delay guarantees Chromium speech IPC completes previous cancel before speaking
        screenReaderTimer = setTimeout(() => {
            if (window.speechSynthesis.paused) window.speechSynthesis.resume();
            window.speechSynthesis.speak(utterance);
        }, 15);
    };

    // Helper to get from localStorage (populated once on load from DB)
    const getOrInitStorage = (key, defaultAttr) => {
        const fullKey = getStorageKey(key);
        let val = localStorage.getItem(fullKey);
        if (val === null && defaultAttr) {
            const attrVal = document.body.getAttribute(defaultAttr);
            if (attrVal) {
                val = (attrVal === 'on' || attrVal === 'true' || attrVal === '1') ? '1' : (attrVal === 'off' || attrVal === 'false' || attrVal === '0' ? '0' : attrVal);
                localStorage.setItem(fullKey, val);
            }
        }
        return val;
    };

    // ── Global Hotkey Map & Helper ──
    const DEFAULT_HOTKEY_MAP = {
        nav_home: 'h',
        nav_decks: 'd',
        nav_accessibility: 'a',
        nav_profile: 'p',
        action_tts: 'Space',
        action_enter: 'Enter',
        quiz_opt1: '1',
        quiz_opt2: '2',
        quiz_opt3: '3',
        quiz_opt4: '4',
        focus_up: 'ArrowUp',
        focus_down: 'ArrowDown',
        focus_left: 'ArrowLeft',
        focus_right: 'ArrowRight',
        toggle_pause: 'Alt+k'
    };

    const getActiveHotkeyMap = () => {
        const saved = localStorage.getItem(getStorageKey('access_hotkey_map'));
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return { ...DEFAULT_HOTKEY_MAP, ...parsed };
            } catch (err) {
                console.error('[Hotkeys] Error parsing map:', err);
            }
        }
        const attrVal = document.body.getAttribute('data-hotkey-map');
        if (attrVal && attrVal !== '{}') {
            try {
                const parsed = JSON.parse(attrVal);
                return { ...DEFAULT_HOTKEY_MAP, ...parsed };
            } catch (err) {}
        }
        return { ...DEFAULT_HOTKEY_MAP };
    };

    // ── Sync Settings to Backend (Firestore) ──
    const syncSettingsToBackend = () => {
        try {
            const payload = {
                text_size: localStorage.getItem(getStorageKey('textSize')) || 'medium',
                line_focus: localStorage.getItem(getStorageKey('access_line_focus')) === '1' ? 'on' : 'off',
                auto_scroll: localStorage.getItem(getStorageKey('access_auto_scroll')) === '1' ? 'on' : 'off',
                screen_reader: localStorage.getItem(getStorageKey('access_screen_reader')) === '1' ? 'on' : 'off',
                tts: localStorage.getItem(getStorageKey('access_tts')) === '1' ? 'on' : 'off',
                hotkeys: localStorage.getItem(getStorageKey('access_hotkeys')) === '0' ? 'off' : 'on',
                hotkey_map: JSON.stringify(getActiveHotkeyMap()),
                color_filter: localStorage.getItem(getStorageKey('daltonizeFilter')) || 'none',
                contrast_theme: localStorage.getItem(getStorageKey('contrastTheme')) || 'none',
                dyslexia_font: localStorage.getItem(getStorageKey('dyslexiaFont')) === '1' ? 'on' : 'off',
                letter_spacing: localStorage.getItem(getStorageKey('letterSpacing')) || 'normal',
                line_spacing: localStorage.getItem(getStorageKey('lineSpacing')) || 'normal',
                tts_playback_rate: localStorage.getItem(getStorageKey('ttsPlaybackRate')) || '1.0',
                content_level: localStorage.getItem(getStorageKey('contentLevel')) || 'medium',
                ruler_thickness: localStorage.getItem(getStorageKey('ruler_thickness')) || 'medium',
                ruler_length: localStorage.getItem(getStorageKey('ruler_length')) || 'full',
                magnetic_ruler: localStorage.getItem(getStorageKey('magnetic_ruler')) === '1' ? 'on' : 'off',
                tts_voice: localStorage.getItem(getStorageKey('ttsVoice')) || 'en-US-AvaNeural',
                tts_engine: localStorage.getItem(getStorageKey('ttsEngine')) || 'azure',
                font_style: localStorage.getItem(getStorageKey('fontStyle')) || 'default'
            };

            fetch('/api/settings/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(payload)
            }).catch(err => console.warn('[Settings-Sync] Background sync notice:', err));
        } catch (e) {
            console.warn('[Settings-Sync] Error preparing sync payload:', e);
        }
    };

    // Reusable custom floating toast notification helper
    const showToast = (message, type = 'error') => {
        const existing = document.getElementById('access-custom-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'access-custom-toast';
        toast.className = 'custom-toast shadow-lg rounded-4 p-3 d-flex align-items-center justify-content-between';
        
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            backgroundColor: type === 'error' ? '#fff5f5' : '#f0fff4',
            border: type === 'error' ? '1.5px solid #feb2b2' : '1.5px solid #9ae6b4',
            color: type === 'error' ? '#9b2c2c' : '#22543d',
            zIndex: '10000',
            maxWidth: '350px',
            transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            transform: 'translateY(50px) scale(0.95)',
            opacity: '0',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
        });

        toast.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <i class="bi ${type === 'error' ? 'bi-exclamation-circle-fill text-danger' : 'bi-check-circle-fill text-success'}" style="font-size: 1.1rem;"></i>
                <span>${message}</span>
            </div>
            <i class="bi bi-x ms-3 text-secondary" style="font-size: 1.25rem;"></i>
        `;

        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.transform = 'translateY(0) scale(1)';
            toast.style.opacity = '1';
        });

        const dismissToast = () => {
            toast.style.transform = 'translateY(20px) scale(0.95)';
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.remove();
            }, 300);
            document.removeEventListener('click', handleOutsideClick);
        };

        toast.addEventListener('click', dismissToast);

        const handleOutsideClick = (e) => {
            if (!toast.contains(e.target)) {
                dismissToast();
            }
        };

        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 50);

        const autoFadeTimer = setTimeout(() => {
            dismissToast();
        }, 4000);

        toast.addEventListener('click', () => clearTimeout(autoFadeTimer));
    };

    // ── Import-a-File card ──────────────────────────────────
    const importCard  = document.getElementById("importCard");
    const fileInput   = document.getElementById("fileImportInput");
    const fileNameEl  = document.getElementById("selectedFileName");

    // Result container elements
    const resultsBox      = document.getElementById("extractionResults");
    const resultBadge     = document.getElementById("resultBadge");
    const resultFilename  = document.getElementById("resultFilename");
    const resultMethod    = document.getElementById("resultMethod");
    const resultPages     = document.getElementById("resultPages");
    const resultWordCount = document.getElementById("resultWordCount");
    const resultPreview   = document.getElementById("resultTextPreview");

    // Generate flashcard elements
    const generateSection = document.getElementById("generateSection");
    const generateBtn     = document.getElementById("generateFlashcardBtn");
    const generateStatus  = document.getElementById("generateStatus");

    // Store last extraction data for flashcard generation
    let lastExtractionData = null;

    if (importCard && fileInput) {
        const triggerImport = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (typeof window.speakScreenReader === "function") {
                window.speakScreenReader("Opening file browser to import a file. Supports PDF, DOCX, and PPTX.");
            }

            // Direct synchronous call preserves browser User Activation so native file picker opens
            fileInput.click();
        };

        // Click the card → announce immediately & open the hidden file picker
        importCard.addEventListener("click", triggerImport);

        // Keyboard navigation: Enter or Space triggers file picker
        importCard.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                triggerImport(e);
            }
        });

        // Hover lift effect
        importCard.addEventListener("mouseenter", () => {
            importCard.style.transform  = "translateY(-4px)";
            importCard.style.boxShadow  = "0 8px 24px rgba(59,73,161,.18)";
        });
        importCard.addEventListener("mouseleave", () => {
            importCard.style.transform  = "";
            importCard.style.boxShadow  = "";
        });

        // File selected → upload to backend for UHTEM extraction
        fileInput.addEventListener("change", () => {
            if (!fileInput.files.length) return;

            const file = fileInput.files[0];

            if (typeof window.speakScreenReader === "function") {
                window.speakScreenReader(`File selected: ${file.name}. Starting extraction. Please wait.`);
            }

            // ── Client-side 20 MB File Size Ceiling ──
            const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
            if (file.size > MAX_FILE_SIZE) {
                if (typeof window.speakScreenReader === "function") {
                    window.speakScreenReader("File size exceeds 20 megabytes limit. Please select a smaller document.");
                }
                if (typeof showToast === "function") {
                    showToast("File size exceeds the 20 MB limit. Please select a smaller document.", "error");
                } else {
                    alert("File size exceeds the 20 MB limit. Please select a smaller document.");
                }
                fileInput.value = "";
                return;
            }

            // Show file name on card
            if (fileNameEl) {
                fileNameEl.textContent = file.name;
            }

            // Show loading state on card
            importCard.style.opacity = "0.6";
            importCard.style.pointerEvents = "none";
            if (fileNameEl) {
                fileNameEl.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Processing "${file.name}"...`;
            }

            // Hide previous results and generate section
            if (resultsBox) resultsBox.style.display = "none";
            if (generateSection) generateSection.style.display = "none";
            const emptyWarningInitEl = document.getElementById("extractionEmptyWarning");
            if (emptyWarningInitEl) {
                emptyWarningInitEl.classList.add("d-none");
                emptyWarningInitEl.classList.remove("d-flex");
            }
            lastExtractionData = null;

            // Initialize progress bar variables
            const progressContainer = document.getElementById("extractionProgressContainer");
            const progressBar = document.getElementById("extractionProgressBar");
            const progressStatus = document.getElementById("progressStatusText");
            const progressPercentage = document.getElementById("progressPercentageText");

            if (progressContainer && progressBar) {
                progressContainer.style.display = "block";
                progressContainer.style.opacity = "1";
                progressBar.style.width = "0%";
                if (progressPercentage) progressPercentage.textContent = "0%";
                if (progressStatus) progressStatus.textContent = "Extracting text and images...";
            }

            // Run smooth, decelerating progress bar simulation
            let simulatedPercent = 0;
            const progressInterval = setInterval(() => {
                if (simulatedPercent < 30) {
                    simulatedPercent += 4;
                } else if (simulatedPercent < 75) {
                    simulatedPercent += 1.5;
                } else if (simulatedPercent < 95) {
                    simulatedPercent += 0.4;
                }
                
                if (progressBar) {
                    progressBar.style.width = `${simulatedPercent}%`;
                }
                if (progressPercentage) {
                    progressPercentage.textContent = `${Math.floor(simulatedPercent)}%`;
                }
            }, 300);

            // Build form data and upload
            const formData = new FormData();
            formData.append("file", file);

            fetch("/upload", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                // Restore card state
                importCard.style.opacity = "1";
                importCard.style.pointerEvents = "auto";

                // Stop progress simulation and animate to 100%
                clearInterval(progressInterval);
                if (progressBar) progressBar.style.width = "100%";
                if (progressPercentage) progressPercentage.textContent = "100%";
                if (progressStatus) progressStatus.textContent = "Extraction complete!";

                // Hide progress bar after a brief delay
                setTimeout(() => {
                    if (progressContainer) {
                        progressContainer.style.opacity = "0";
                        setTimeout(() => {
                            progressContainer.style.display = "none";
                        }, 300);
                    }
                }, 800);

                if (data.success) {
                    // Update file name
                    if (fileNameEl) {
                        fileNameEl.textContent = `✔ ${data.filename}`;
                        fileNameEl.style.color = "#28a745";
                    }

                    // Inform user if document was gracefully truncated to 25 content pages
                    if (data.is_truncated) {
                        if (typeof showToast === "function") {
                            showToast(`Processed the first ${data.total_pages} content-bearing pages of "${data.filename}" (remaining/blank pages omitted for fast study deck creation).`, "info");
                        }
                    }

                    // Populate results panel
                    if (resultsBox) {
                        const totalWords = data.pages.reduce((sum, p) => sum + p.word_count, 0);
                        const firstMethod = data.pages.length > 0 ? data.pages[0].extraction_method : "N/A";
                        const fullText = data.pages.map(p => p.text).join("\n\n").trim();
                        
                        // Check if document actually has readable text
                        const hasExtractedText = totalWords > 0 && fullText.length > 0;

                        // Use simplified text preview if active
                        const previewSourceText = (data.simplified_text || fullText).trim();
                        const previewText = previewSourceText.length > 1500 ? previewSourceText.substring(0, 1500) + "..." : previewSourceText;

                        // Empty warning element toggle
                        const emptyWarningEl = document.getElementById("extractionEmptyWarning");
                        if (emptyWarningEl) {
                            if (hasExtractedText) {
                                emptyWarningEl.classList.add("d-none");
                                emptyWarningEl.classList.remove("d-flex");
                            } else {
                                emptyWarningEl.classList.remove("d-none");
                                emptyWarningEl.classList.add("d-flex");
                            }
                        }

                        // Toggle simplification badge based on backend flag
                        const simplBadge = document.getElementById("simplificationBadge");
                        if (simplBadge) {
                            if (data.simplified_text) {
                                simplBadge.classList.remove("d-none");
                            } else {
                                simplBadge.classList.add("d-none");
                            }
                        }

                        if (resultBadge)     resultBadge.textContent     = firstMethod;
                        if (resultFilename)  resultFilename.textContent  = data.filename;
                        if (resultMethod)    resultMethod.textContent    = firstMethod;
                        if (resultPages)     resultPages.textContent     = data.total_pages;
                        if (resultWordCount) resultWordCount.textContent = totalWords.toLocaleString();
                        if (resultPreview)   resultPreview.textContent   = previewText || "(No text extracted)";

                        resultsBox.style.display = "block";

                        if (hasExtractedText) {
                            // Store extraction data for flashcard generation
                            lastExtractionData = {
                                filename: data.filename,
                                extracted_text: data.simplified_text || fullText,
                                original_extracted_text: data.simplified_text ? fullText : null,
                                total_pages: data.total_pages,
                                word_count: totalWords
                            };

                            if (typeof window.speakScreenReader === "function") {
                                window.speakScreenReader(`Extraction complete for ${data.filename}. ${totalWords.toLocaleString()} words extracted across ${data.total_pages} pages. Ready to generate flashcards.`);
                            }

                            // Show the Generate Flashcard section
                            if (generateSection) {
                                generateSection.style.display = "block";
                            }
                            // Reset generate button state
                            if (generateBtn) {
                                generateBtn.disabled = false;
                                generateBtn.innerHTML = `<span style="font-size:1.3rem;">&#9889;</span> Generate Flashcard`;
                            }
                            if (generateStatus) {
                                generateStatus.style.display = "none";
                            }
                        } else {
                            // Empty file: Do NOT allow generation
                            lastExtractionData = null;
                            if (typeof window.speakScreenReader === "function") {
                                window.speakScreenReader(`Extraction finished, but no readable text was detected in ${data.filename}. Please select another document.`);
                            }
                            if (generateSection) {
                                generateSection.style.display = "none";
                            }
                            if (typeof showToast === "function") {
                                showToast("The uploaded file contains no readable text to generate flashcards.", "error");
                            }
                        }
                    }
                } else {
                    // Error from server
                    if (fileNameEl) {
                        fileNameEl.textContent = `⚠ Error: ${data.error}`;
                        fileNameEl.style.color = "#dc3545";
                    }
                    if (typeof window.speakScreenReader === "function") {
                        window.speakScreenReader(`Extraction error: ${data.error || 'Upload failed. Please check the document.'}`);
                    }
                    if (typeof showToast === "function") {
                        showToast(data.error || "Upload failed. Please check the document.", "error");
                    }
                }
            })
            .catch(err => {
                // Network / unexpected error
                clearInterval(progressInterval);
                if (progressContainer) progressContainer.style.display = "none";
                
                importCard.style.opacity = "1";
                importCard.style.pointerEvents = "auto";
                if (fileNameEl) {
                    fileNameEl.textContent = `⚠ Upload failed: ${err.message}`;
                    fileNameEl.style.color = "#dc3545";
                }
                if (typeof window.speakScreenReader === "function") {
                    window.speakScreenReader(`Upload failed: ${err.message}`);
                }
                console.error("[UHTEM Upload Error]", err);
            })
            .finally(() => {
                // Reset file input so the same file can be re-selected
                fileInput.value = "";
            });
        });
    }

    // ── Generate Flashcard button & Structure Modal ───────────────────────────
    if (generateBtn) {
        // Hover effect
        generateBtn.addEventListener("mouseenter", () => {
            generateBtn.style.transform  = "translateY(-2px)";
            generateBtn.style.boxShadow  = "0 6px 20px rgba(59,73,161,.25)";
        });
        generateBtn.addEventListener("mouseleave", () => {
            generateBtn.style.transform  = "";
            generateBtn.style.boxShadow  = "";
        });

        const deckStructureModalEl = document.getElementById("deckStructureModal");
        const cardDescriptive      = document.getElementById("structureCardDescriptive");
        const cardQuestion         = document.getElementById("structureCardQuestion");
        const btnConfirmGenDeck    = document.getElementById("btnConfirmGenerateDeck");

        let selectedStructure = "descriptive"; // Default to descriptive

        const selectStructure = (type) => {
            selectedStructure = type;
            if (cardDescriptive && cardQuestion) {
                if (type === "descriptive") {
                    cardDescriptive.style.borderColor = "#3b49a1";
                    cardDescriptive.style.background = "#f4f6fd";
                    cardDescriptive.setAttribute("aria-checked", "true");
                    const check1 = cardDescriptive.querySelector(".structure-check-icon");
                    if (check1) check1.innerHTML = '<i class="bi bi-check-circle-fill fs-5" style="color: #3b49a1;"></i>';

                    cardQuestion.style.borderColor = "#e2e8f0";
                    cardQuestion.style.background = "#ffffff";
                    cardQuestion.setAttribute("aria-checked", "false");
                    const check2 = cardQuestion.querySelector(".structure-check-icon");
                    if (check2) check2.innerHTML = '<i class="bi bi-circle fs-5 text-muted"></i>';

                    if (typeof window.speakScreenReader === "function") {
                        window.speakScreenReader("Descriptive Type selected. Formatted in 2-sentence paragraphs.");
                    }
                } else {
                    cardQuestion.style.borderColor = "#6366f1";
                    cardQuestion.style.background = "#f5f6ff";
                    cardQuestion.setAttribute("aria-checked", "true");
                    const check2 = cardQuestion.querySelector(".structure-check-icon");
                    if (check2) check2.innerHTML = '<i class="bi bi-check-circle-fill fs-5" style="color: #6366f1;"></i>';

                    cardDescriptive.style.borderColor = "#e2e8f0";
                    cardDescriptive.style.background = "#ffffff";
                    cardDescriptive.setAttribute("aria-checked", "false");
                    const check1 = cardDescriptive.querySelector(".structure-check-icon");
                    if (check1) check1.innerHTML = '<i class="bi bi-circle fs-5 text-muted"></i>';

                    if (typeof window.speakScreenReader === "function") {
                        window.speakScreenReader("Question Type selected. Active recall question and answer pairs.");
                    }
                }
            }
        };

        if (cardDescriptive) {
            cardDescriptive.addEventListener("click", (e) => {
                if (e) e.stopPropagation();
                selectStructure("descriptive");
            });
            cardDescriptive.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (e) e.stopPropagation();
                    selectStructure("descriptive");
                }
            });
        }
        if (cardQuestion) {
            cardQuestion.addEventListener("click", (e) => {
                if (e) e.stopPropagation();
                selectStructure("question");
            });
            cardQuestion.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (e) e.stopPropagation();
                    selectStructure("question");
                }
            });
        }

        const executeDeckGeneration = () => {
            if (!lastExtractionData || !lastExtractionData.extracted_text || !lastExtractionData.extracted_text.trim()) {
                if (typeof window.speakScreenReader === "function") {
                    window.speakScreenReader("Cannot generate flashcards: No extracted text available.");
                }
                if (typeof showToast === "function") {
                    showToast("Cannot generate flashcards: The uploaded file contains no text.", "error");
                }
                return;
            }

            // Close the modal if open
            if (deckStructureModalEl && typeof bootstrap !== "undefined") {
                const modalInstance = bootstrap.Modal.getInstance(deckStructureModalEl);
                if (modalInstance) {
                    modalInstance.hide();
                }
            }

            // Trigger loading modal only when valid content exists
            const loadingSubtext = selectedStructure === "descriptive"
                ? "Formulating 2-sentence descriptive paragraphs & quiz items..."
                : "Extracting key concepts & generating question pairs...";

            if (typeof window.speakScreenReader === "function") {
                const typeText = selectedStructure === "descriptive" ? "descriptive" : "question";
                window.speakScreenReader(`Generating ${typeText} flashcards and study quiz. Please wait.`);
            }

            if (typeof window.showQuizPopLoading === "function") {
                window.showQuizPopLoading("Generating Flashcards & Quiz...", loadingSubtext);
            }

            // Loading state on trigger button
            generateBtn.disabled = true;
            generateBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span> Generating...`;
            if (generateStatus) generateStatus.style.display = "none";

            const payload = {
                ...lastExtractionData,
                deck_structure: selectedStructure
            };

            fetch("/generate-flashcard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Success state
                    generateBtn.innerHTML = `<span style="font-size:1.3rem;">✔</span> Deck Created!`;
                    generateBtn.style.background = "#28a745";

                    if (typeof window.speakScreenReader === "function") {
                        window.speakScreenReader(`Flashcard deck "${data.deck_name}" created successfully with ${data.card_count} cards. Loading your deck.`);
                    }

                    if (generateStatus) {
                        generateStatus.textContent = `"${data.deck_name}" added to My Decks`;
                        generateStatus.style.color = "#28a745";
                        generateStatus.style.display = "block";
                    }

                    // Redirect to My Decks after a short delay
                    setTimeout(() => {
                        window.location.href = "/decks";
                    }, 1500);
                } else {
                    // Hide loading modal on error
                    if (typeof window.hideQuizPopLoading === "function") {
                        window.hideQuizPopLoading();
                    }

                    // Error
                    generateBtn.disabled = false;
                    generateBtn.innerHTML = `<span style="font-size:1.3rem;">&#9889;</span> Generate Flashcard`;
                    generateBtn.style.background = "#3b49a1";

                    if (typeof window.speakScreenReader === "function") {
                        window.speakScreenReader(`Generation failed: ${data.error || 'Please try again.'}`);
                    }

                    if (generateStatus) {
                        generateStatus.textContent = `⚠ ${data.error}`;
                        generateStatus.style.color = "#dc3545";
                        generateStatus.style.display = "block";
                    }
                    if (typeof showToast === "function") {
                        showToast(data.error || "Flashcard generation failed.", "error");
                    }
                }
            })
            .catch(err => {
                if (typeof window.hideQuizPopLoading === "function") {
                    window.hideQuizPopLoading();
                }

                generateBtn.disabled = false;
                generateBtn.innerHTML = `<span style="font-size:1.3rem;">&#9889;</span> Generate Flashcard`;
                generateBtn.style.background = "#3b49a1";

                if (typeof window.speakScreenReader === "function") {
                    window.speakScreenReader(`Generation error: ${err.message}`);
                }

                if (generateStatus) {
                    generateStatus.textContent = `⚠ Generation failed: ${err.message}`;
                    generateStatus.style.color = "#dc3545";
                    generateStatus.style.display = "block";
                }
                if (typeof showToast === "function") {
                    showToast(`Generation failed: ${err.message}`, "error");
                }
                console.error("[Flashcard Generation Error]", err);
            });
        };

        if (btnConfirmGenDeck) {
            btnConfirmGenDeck.addEventListener("click", (e) => {
                if (e) e.stopPropagation();
                executeDeckGeneration();
            });
        }

        generateBtn.addEventListener("click", (e) => {
            if (e) e.stopPropagation();
            if (!lastExtractionData || !lastExtractionData.extracted_text || !lastExtractionData.extracted_text.trim()) {
                if (typeof window.speakScreenReader === "function") {
                    window.speakScreenReader("Cannot generate flashcards: No extracted text available.");
                }
                if (typeof showToast === "function") {
                    showToast("Cannot generate flashcards: The uploaded file contains no text.", "error");
                }
                return;
            }

            if (typeof window.speakScreenReader === "function") {
                window.speakScreenReader("Choose deck structure. Select Descriptive type or Question type, then click Generate Deck.");
            }

            // Open the Deck Structure Selection Modal
            if (deckStructureModalEl && typeof bootstrap !== "undefined") {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(deckStructureModalEl);
                modalInstance.show();
            } else {
                // Fallback to direct generation if modal is missing
                executeDeckGeneration();
            }
        });
    }


    // ── Daltonization Color Filters ─────────────────────────
    const applyDaltonizeFilter = (filterValue) => {
        const val = filterValue || 'none';
        document.documentElement.setAttribute('data-color-filter', val);
        document.body.setAttribute('data-color-filter', val);
        // Clear inline filter on body so it doesn't create a transformed containing block that breaks position:fixed
        document.body.style.filter = '';
        if (val === 'none') {
            document.documentElement.style.filter = '';
        } else {
            // Apply the SVG filter ID to the root html element
            document.documentElement.style.filter = `url(#daltonize-${val})`;
        }
    };

    // 1. Load saved preference
    const isTestPage = window.location.pathname === '/ishihara-test' || window.location.pathname === '/ishihara-prompt';
    const savedFilter = isTestPage ? 'none' : (getOrInitStorage('daltonizeFilter', 'data-color-filter') || 'none');
    applyDaltonizeFilter(savedFilter);

    // 2. Set up event listeners for the radio buttons (only exists on accessibility page)
    const daltonizeRadios = document.querySelectorAll('.daltonize-radio');
    if (daltonizeRadios.length > 0) {
        // Set the correct radio as checked based on saved preference
        daltonizeRadios.forEach(radio => {
            if (radio.value === savedFilter) {
                radio.checked = true;
            }

            // Listen for changes
            radio.addEventListener('change', (e) => {
                const selectedFilter = e.target.value;
                localStorage.setItem(getStorageKey('daltonizeFilter'), selectedFilter);
                applyDaltonizeFilter(selectedFilter);
                syncSettingsToBackend();
            });
        });
    }

    // Setup Content Reading Level radio triggers
    const savedContentLevel = getOrInitStorage('contentLevel', 'data-content-level') || 'medium';
    const contentLevelRadios = document.querySelectorAll('.content-level-radio');
    if (contentLevelRadios.length > 0) {
        contentLevelRadios.forEach(radio => {
            if (radio.value.toLowerCase() === savedContentLevel.toLowerCase()) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                const selectedLevel = e.target.value;
                localStorage.setItem(getStorageKey('contentLevel'), selectedLevel);
                document.body.setAttribute('data-content-level', selectedLevel);
                syncSettingsToBackend();
            });
        });
    }

    // Apply background colors to deck color badges from data-bg to bypass HTML/CSS validator errors in IDEs
    document.querySelectorAll('.deck-color-badge[data-bg]').forEach(el => {
        const bg = el.getAttribute('data-bg');
        if (bg) {
            el.style.backgroundColor = bg;
        }
    });

    // ── Accessibility Ruler Customizations (Height & Width) ──
    const applyRulerCustomizations = () => {
        const thickness = getOrInitStorage('ruler_thickness', 'data-ruler-thickness') || 'medium';
        const length = getOrInitStorage('ruler_length', 'data-ruler-length') || 'full';

        let heightVal = '90px';
        if (thickness === 'small') heightVal = '50px';
        else if (thickness === 'large') heightVal = '130px';
        else if (thickness === 'xl') heightVal = '170px';

        document.documentElement.style.setProperty('--focus-height', heightVal);

        const mainContent = document.querySelector('.main-content');
        if (mainContent && length === 'medium') {
            const rect = mainContent.getBoundingClientRect();
            document.documentElement.style.setProperty('--focus-width', `${rect.width}px`);
            document.documentElement.style.setProperty('--focus-left', `${rect.left + rect.width / 2}px`);
        } else if (mainContent && length === 'wide') {
            const rect = mainContent.getBoundingClientRect();
            document.documentElement.style.setProperty('--focus-width', `${rect.width * 0.75}px`);
            document.documentElement.style.setProperty('--focus-left', `${rect.left + rect.width / 2}px`);
        } else {
            document.documentElement.style.setProperty('--focus-width', '100vw');
            document.documentElement.style.setProperty('--focus-left', '50%');
        }

        document.body.setAttribute('data-ruler-thickness', thickness);
        document.body.setAttribute('data-ruler-length', length);
    };

    // Apply ruler adjustments & attach resize listener to keep snaps aligned
    applyRulerCustomizations();
    window.addEventListener('resize', applyRulerCustomizations);

    // ── Accessibility Text Modifications (Dyslexia Font, Sizing, Spacing) ──
    const applyTextModifications = () => {
        const dyslexiaFont = getOrInitStorage('dyslexiaFont', 'data-dyslexia-font') === '1';
        const fontStyle = getOrInitStorage('fontStyle', 'data-font-style') || 'default';
        const savedTextSize = getOrInitStorage('textSize', 'data-text-size') || 'medium';
        const textSize = savedTextSize;
        const letterSpacing = getOrInitStorage('letterSpacing', 'data-letter-spacing') || 'normal';
        const lineSpacing = getOrInitStorage('lineSpacing', 'data-line-spacing') || 'normal';

        // 1. Dyslexia Font
        if (dyslexiaFont || fontStyle === 'opendyslexic') {
            document.body.classList.add('dyslexia-mode');
        } else {
            document.body.classList.remove('dyslexia-mode');
        }

        // 2. Text Size
        document.body.classList.remove('text-size-medium', 'text-size-large', 'text-size-xl');
        document.body.classList.add(`text-size-${textSize}`);
        
        // Handle backend bootstrap classes bigger-ui-mode and bigger-ui-mode-xl
        if (textSize === 'large') {
            document.body.classList.remove('bigger-ui-mode-xl');
            document.body.classList.add('bigger-ui-mode');
        } else if (textSize === 'xl') {
            document.body.classList.remove('bigger-ui-mode');
            document.body.classList.add('bigger-ui-mode-xl');
        } else {
            document.body.classList.remove('bigger-ui-mode', 'bigger-ui-mode-xl');
        }

        // 3. Letter Spacing
        document.body.classList.remove('letter-spacing-normal', 'letter-spacing-wide', 'letter-spacing-xl');
        document.body.classList.add(`letter-spacing-${letterSpacing}`);

        // 4. Line Spacing
        document.body.classList.remove('line-spacing-normal', 'line-spacing-wide', 'line-spacing-xl');
        document.body.classList.add(`line-spacing-${lineSpacing}`);

        // Update real-time body attributes
        document.body.setAttribute('data-dyslexia-font', dyslexiaFont ? 'on' : 'off');
        document.body.setAttribute('data-font-style', fontStyle);
        document.body.setAttribute('data-text-size', textSize);
        document.body.setAttribute('data-letter-spacing', letterSpacing);
        document.body.setAttribute('data-line-spacing', lineSpacing);
    };

    // Initialize/Apply text settings immediately on page load
    applyTextModifications();

    // Set up controls in Accessibility page if they exist
    const switchDyslexia = document.getElementById('switchDyslexiaFont');
    const textSizeRadios = document.querySelectorAll('.text-size-radio');
    const letterSpacingRadios = document.querySelectorAll('.letter-spacing-radio');
    const lineSpacingRadios = document.querySelectorAll('.line-spacing-radio');
    
    const switchScreenReader = document.getElementById('switchScreenReader');
    const switchTts = document.getElementById('switchTts');
    const switchLineFocus = document.getElementById('switchLineFocus');
    const switchAutoScroll = document.getElementById('switchAutoScroll');

    const selectFontStyle = document.getElementById('selectFontStyle');

    if (selectFontStyle) {
        const savedFontStyle = getOrInitStorage('fontStyle', 'data-font-style') || 'default';
        selectFontStyle.value = savedFontStyle;
        
        selectFontStyle.addEventListener('change', (e) => {
            const chosenFont = e.target.value;
            localStorage.setItem(getStorageKey('fontStyle'), chosenFont);
            
            // Sync with old dyslexia switch
            if (switchDyslexia) {
                const isDyslexic = (chosenFont === 'opendyslexic');
                switchDyslexia.checked = isDyslexic;
                localStorage.setItem(getStorageKey('dyslexiaFont'), isDyslexic ? '1' : '0');
                document.body.setAttribute('data-dyslexia-font', isDyslexic ? 'on' : 'off');
            }
            
            applyTextModifications();
            syncSettingsToBackend();
        });
    }

    if (switchDyslexia) {
        switchDyslexia.checked = getOrInitStorage('dyslexiaFont', 'data-dyslexia-font') === '1';
        switchDyslexia.addEventListener('change', (e) => {
            localStorage.setItem(getStorageKey('dyslexiaFont'), e.target.checked ? '1' : '0');
            document.body.setAttribute('data-dyslexia-font', e.target.checked ? 'on' : 'off');
            
            const syncFontVal = e.target.checked ? 'opendyslexic' : 'default';
            localStorage.setItem(getStorageKey('fontStyle'), syncFontVal);
            if (selectFontStyle) {
                selectFontStyle.value = syncFontVal;
            }
            
            applyTextModifications();
            syncSettingsToBackend();
        });
    }

    if (textSizeRadios.length > 0) {
        const savedTextSize = getOrInitStorage('textSize', 'data-text-size') || 'medium';
        textSizeRadios.forEach(radio => {
            if (radio.value === savedTextSize) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('textSize'), e.target.value);
                applyTextModifications();
                syncSettingsToBackend();
            });
        });
    }

    if (letterSpacingRadios.length > 0) {
        const currentLetterSpacing = localStorage.getItem(getStorageKey('letterSpacing')) || 'normal';
        letterSpacingRadios.forEach(radio => {
            if (radio.value === currentLetterSpacing) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('letterSpacing'), e.target.value);
                applyTextModifications();
                syncSettingsToBackend();
            });
        });
    }

    if (lineSpacingRadios.length > 0) {
        const currentLineSpacing = localStorage.getItem(getStorageKey('lineSpacing')) || 'normal';
        lineSpacingRadios.forEach(radio => {
            if (radio.value === currentLineSpacing) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('lineSpacing'), e.target.value);
                applyTextModifications();
                syncSettingsToBackend();
            });
        });
    }

    // Initialize switches from database recommendation defaults (Agency Controller)
    const ttsSpeedContainer = document.getElementById('ttsSpeedContainer');
    const sliderTtsRate = document.getElementById('sliderTtsRate');
    const ttsRateValue = document.getElementById('ttsRateValue');
    const ttsVoiceContainer = document.getElementById('ttsVoiceContainer');
    const selectTtsVoice = document.getElementById('selectTtsVoice');

    if (switchScreenReader) {
        const isEnabled = getOrInitStorage('access_screen_reader', 'data-screen-reader') === '1';
        switchScreenReader.checked = isEnabled;

        switchScreenReader.addEventListener('change', (e) => {
            localStorage.setItem(getStorageKey('access_screen_reader'), e.target.checked ? '1' : '0');
            document.body.setAttribute('data-screen-reader', e.target.checked ? 'on' : 'off');
            
            // Stop focused element reader if toggled off
            if (!e.target.checked && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            syncSettingsToBackend();
        });
    }

    if (switchTts) {
        const toggleSpeedContainer = (show) => {
            if (ttsSpeedContainer) {
                ttsSpeedContainer.style.display = show ? 'block' : 'none';
            }
            if (ttsVoiceContainer) {
                ttsVoiceContainer.style.display = show ? 'block' : 'none';
            }
        };

        const isEnabled = getOrInitStorage('access_tts', 'data-tts') === '1';
        switchTts.checked = isEnabled;
        toggleSpeedContainer(isEnabled);

        switchTts.addEventListener('change', (e) => {
            localStorage.setItem(getStorageKey('access_tts'), e.target.checked ? '1' : '0');
            document.body.setAttribute('data-tts', e.target.checked ? 'on' : 'off');
            toggleSpeedContainer(e.target.checked);
            applyTtsVisibility();
            if (e.target.checked && typeof updateSliderFill === 'function') {
                updateSliderFill();
            }
            
            // Stop active speech playback if toggled off
            if (!e.target.checked) {
                if (window.stopAutoplay) {
                    window.stopAutoplay();
                }
            }
            syncSettingsToBackend();
        });
    }

    if (sliderTtsRate) {
        const savedRate = localStorage.getItem(getStorageKey('ttsPlaybackRate')) || document.body.getAttribute('data-tts-rate') || '1.0';
        sliderTtsRate.value = savedRate;
        if (ttsRateValue) {
            ttsRateValue.textContent = `${parseFloat(savedRate).toFixed(2)}x`;
        }

        var updateSliderFill = () => {
            const min = parseFloat(sliderTtsRate.min) || 0.5;
            const max = parseFloat(sliderTtsRate.max) || 2.0;
            const val = parseFloat(sliderTtsRate.value) || 1.0;
            const pct = Math.min(Math.max(((val - min) / (max - min)) * 100, 0), 100);
            sliderTtsRate.style.background = `linear-gradient(to right, var(--primary-blue, #5671C9) 0%, var(--primary-blue, #5671C9) ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`;
        };

        updateSliderFill();

        sliderTtsRate.addEventListener('input', (e) => {
            const rate = e.target.value;
            localStorage.setItem(getStorageKey('ttsPlaybackRate'), rate);
            document.body.setAttribute('data-tts-rate', rate);
            if (ttsRateValue) {
                ttsRateValue.textContent = `${parseFloat(rate).toFixed(2)}x`;
            }
            if (window.TelemetryTracker && typeof window.TelemetryTracker.setTTSPlaybackRate === 'function') {
                window.TelemetryTracker.setTTSPlaybackRate(rate);
            }
            updateSliderFill();
        });

        sliderTtsRate.addEventListener('change', () => {
            updateSliderFill();
            syncSettingsToBackend();
        });
    }

    const selectTtsEngine = document.getElementById('selectTtsEngine');
    const ttsEngineVoices = {
        azure: [
            { value: "en-US-AvaNeural", text: "Ava (Female - Professional)" },
            { value: "en-US-EmmaNeural", text: "Emma (Female - Reassuring)" },
            { value: "en-US-JennyNeural", text: "Jenny (Female - Playful & Warm)" },
            { value: "en-US-AnaNeural", text: "Ana (Female - Friendly)" },
            { value: "en-US-AndrewNeural", text: "Andrew (Male - Storyteller)" },
            { value: "en-US-SteffanNeural", text: "Steffan (Male - Deep & Comforting)" },
            { value: "en-US-BrianNeural", text: "Brian (Male - Conversational)" },
            { value: "en-US-ChristopherNeural", text: "Christopher (Male - Active)" }
        ],
        elevenlabs: [
            { value: "Xb7hH8MSUJpSbSDYk0k2", text: "Alice (Female - Clear)" },
            { value: "EXAVITQu4vr4xnSDxMaL", text: "Sarah (Female - Professional)" },
            { value: "jz3ZhMqlkCVI6zGzELGw", text: "Maya (Female - Expressive)" },
            { value: "2mjoFhAXQxxi6hlzpupi", text: "Miguel (Male - Dynamic)" },
            { value: "TX3LPaxmHKxFdv7VOQHJ", text: "Liam (Male - Conversational)" }
        ],
        gtts: [
            { value: "default", text: "Default System Voice" }
        ]
    };

    if (selectTtsEngine && selectTtsVoice) {
        const savedEngine = localStorage.getItem(getStorageKey('ttsEngine')) || document.body.getAttribute('data-tts-engine') || 'azure';
        selectTtsEngine.value = savedEngine;
        
        function populateVoices(engineVal, savedVoiceVal) {
            selectTtsVoice.innerHTML = '';
            const list = ttsEngineVoices[engineVal] || [];
            list.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.value;
                opt.textContent = v.text;
                selectTtsVoice.appendChild(opt);
            });
            if (savedVoiceVal && list.some(item => item.value === savedVoiceVal)) {
                selectTtsVoice.value = savedVoiceVal;
            } else if (list.length > 0) {
                selectTtsVoice.value = list[0].value;
                localStorage.setItem(getStorageKey('ttsVoice'), list[0].value);
                document.body.setAttribute('data-tts-voice', list[0].value);
            }
        }

        const initialVoice = localStorage.getItem(getStorageKey('ttsVoice')) || document.body.getAttribute('data-tts-voice') || 'en-US-AvaNeural';
        populateVoices(savedEngine, initialVoice);

        selectTtsEngine.addEventListener('change', (e) => {
            const engine = e.target.value;
            localStorage.setItem(getStorageKey('ttsEngine'), engine);
            document.body.setAttribute('data-tts-engine', engine);
            populateVoices(engine, null);
            syncSettingsToBackend();
        });

        selectTtsVoice.addEventListener('change', (e) => {
            const voice = e.target.value;
            localStorage.setItem(getStorageKey('ttsVoice'), voice);
            document.body.setAttribute('data-tts-voice', voice);
            syncSettingsToBackend();
        });
    }

    const lineFocusCustomizationContainer = document.getElementById('lineFocusCustomizationContainer');
    const selectRulerThickness = document.getElementById('selectRulerThickness');
    const selectRulerLength = document.getElementById('selectRulerLength');
    const switchMagneticRuler = document.getElementById('switchMagneticRuler');

    if (switchLineFocus) {
        const updateLineFocusContainerVisibility = (show) => {
            if (lineFocusCustomizationContainer) {
                lineFocusCustomizationContainer.style.display = show ? 'block' : 'none';
            }
        };

        const isLineFocusEnabled = getOrInitStorage('access_line_focus', 'data-line-focus') === '1';
        switchLineFocus.checked = isLineFocusEnabled;
        updateLineFocusContainerVisibility(isLineFocusEnabled);

        switchLineFocus.addEventListener('change', (e) => {
            localStorage.setItem(getStorageKey('access_line_focus'), e.target.checked ? '1' : '0');
            document.body.setAttribute('data-line-focus', e.target.checked ? 'on' : 'off');
            updateLineFocusContainerVisibility(e.target.checked);
            syncSettingsToBackend();
        });

        // Initialize Ruler Thickness
        if (selectRulerThickness) {
            const savedThickness = localStorage.getItem(getStorageKey('ruler_thickness')) || 'medium';
            selectRulerThickness.value = savedThickness;
            selectRulerThickness.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('ruler_thickness'), e.target.value);
                applyRulerCustomizations();
                syncSettingsToBackend();
            });
        }

        // Initialize Ruler Length
        if (selectRulerLength) {
            const savedLength = localStorage.getItem(getStorageKey('ruler_length')) || 'full';
            selectRulerLength.value = savedLength;
            selectRulerLength.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('ruler_length'), e.target.value);
                applyRulerCustomizations();
                syncSettingsToBackend();
            });
        }

        // Initialize Magnetic Snapping Toggle
        if (switchMagneticRuler) {
            const isMagnetic = getOrInitStorage('magnetic_ruler', 'data-magnetic-ruler') === '1';
            switchMagneticRuler.checked = isMagnetic;
            switchMagneticRuler.addEventListener('change', (e) => {
                localStorage.setItem(getStorageKey('magnetic_ruler'), e.target.checked ? '1' : '0');
                document.body.setAttribute('data-magnetic-ruler', e.target.checked ? 'on' : 'off');
                syncSettingsToBackend();
            });
        }
    }

    if (switchAutoScroll) {
        switchAutoScroll.checked = getOrInitStorage('access_auto_scroll', 'data-auto-scroll') === '1';
        switchAutoScroll.addEventListener('change', (e) => {
            localStorage.setItem(getStorageKey('access_auto_scroll'), e.target.checked ? '1' : '0');
            document.body.setAttribute('data-auto-scroll', e.target.checked ? 'on' : 'off');
            syncSettingsToBackend();
        });
    }

    // ── Keyboard Shortcuts Settings Controller ──
    const switchHotkeys = document.getElementById('switchHotkeys');
    const hotkeysGuideContainer = document.getElementById('hotkeysGuideContainer');
    const hotkeyInputs = document.querySelectorAll('.hotkey-input');
    const btnResetHotkeys = document.getElementById('btnResetHotkeys');

    const updateHotkeyInputsUI = () => {
        const activeMap = getActiveHotkeyMap();
        hotkeyInputs.forEach(input => {
            const action = input.getAttribute('data-action');
            if (activeMap[action]) {
                input.value = activeMap[action];
            }
        });
    };

    if (switchHotkeys) {
        const isEnabled = getOrInitStorage('access_hotkeys', 'data-hotkeys') !== '0'; // default on
        switchHotkeys.checked = isEnabled;
        if (hotkeysGuideContainer) {
            hotkeysGuideContainer.style.display = isEnabled ? 'block' : 'none';
        }

        switchHotkeys.addEventListener('change', (e) => {
            const val = e.target.checked ? '1' : '0';
            localStorage.setItem(getStorageKey('access_hotkeys'), val);
            document.body.setAttribute('data-hotkeys', e.target.checked ? 'on' : 'off');
            if (hotkeysGuideContainer) {
                hotkeysGuideContainer.style.display = e.target.checked ? 'block' : 'none';
            }
            syncSettingsToBackend();
        });
    }

    if (hotkeyInputs.length > 0) {
        updateHotkeyInputsUI();

        hotkeyInputs.forEach(input => {
            input.addEventListener('focus', () => {
                input.value = 'Press keys...';
                input.style.borderColor = 'var(--primary-blue, #5671C9)';
                input.style.boxShadow = '0 0 0 3px rgba(86,113,201,0.25)';
                input.classList.remove('bg-light');
                input.classList.add('bg-white');
            });

            input.addEventListener('blur', () => {
                input.style.borderColor = '';
                input.style.boxShadow = '';
                input.classList.remove('bg-white');
                input.classList.add('bg-light');
                updateHotkeyInputsUI();
            });

            input.addEventListener('keydown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Build combination string
                let modifiers = [];
                if (e.altKey) modifiers.push('Alt');
                if (e.ctrlKey) modifiers.push('Ctrl');
                if (e.shiftKey) modifiers.push('Shift');

                let keyName = e.key;
                if (keyName === ' ') keyName = 'Space';
                else if (keyName.length === 1) keyName = keyName.toLowerCase();

                // Check if standalone modifier key was pressed
                if (['Alt', 'Control', 'Shift', 'CapsLock', 'Meta'].includes(keyName)) {
                    // Do nothing yet, wait for main key
                    input.value = modifiers.join('+') + '+...';
                    return;
                }

                modifiers.push(keyName);
                const comboString = modifiers.join('+');

                // Check for duplicate key mapping (collision detection)
                const action = input.getAttribute('data-action');
                const activeMap = getActiveHotkeyMap();
                const duplicateAction = Object.keys(activeMap).find(act => act !== action && activeMap[act] === comboString);
                
                if (duplicateAction) {
                    // Flash conflicting input in red briefly to visually guide the user
                    const conflictingInput = document.querySelector(`.hotkey-input[data-action="${duplicateAction}"]`);
                    if (conflictingInput) {
                        conflictingInput.style.borderColor = '#dc3545';
                        conflictingInput.style.boxShadow = '0 0 0 3px rgba(220,53,69,0.25)';
                        setTimeout(() => {
                            conflictingInput.style.borderColor = '';
                            conflictingInput.style.boxShadow = '';
                        }, 1500);
                    }
                    
                    const actionLabels = {
                        nav_home: 'Go to Home',
                        nav_decks: 'Go to My Decks',
                        nav_accessibility: 'Go to Accessibility',
                        nav_profile: 'Go to Profile',
                        action_tts: 'Read TTS (Speak)',
                        action_enter: 'Submit/Next Quiz',
                        quiz_opt1: 'Quiz Option 1',
                        quiz_opt2: 'Quiz Option 2',
                        quiz_opt3: 'Quiz Option 3',
                        quiz_opt4: 'Quiz Option 4'
                    };
                    const label = actionLabels[duplicateAction] || duplicateAction;
                    
                    showToast(`Shortcut '${comboString}' is already assigned to '${label}'. Please choose a different shortcut.`);
                    input.blur();
                    return;
                }

                // Update input & map
                activeMap[action] = comboString;

                localStorage.setItem(getStorageKey('access_hotkey_map'), JSON.stringify(activeMap));
                document.body.setAttribute('data-hotkey-map', JSON.stringify(activeMap));
                
                input.value = comboString;
                input.blur();
                syncSettingsToBackend();
            });
        });
    }

    if (btnResetHotkeys) {
        btnResetHotkeys.addEventListener('click', () => {
            localStorage.setItem(getStorageKey('access_hotkey_map'), JSON.stringify(DEFAULT_HOTKEY_MAP));
            document.body.setAttribute('data-hotkey-map', JSON.stringify(DEFAULT_HOTKEY_MAP));
            updateHotkeyInputsUI();
            syncSettingsToBackend();
        });
    }

    // ── Low Vision Contrast Themes Manager ──
    const applyContrastTheme = (theme) => {
        document.body.classList.remove('contrast-theme-dark', 'contrast-theme-light');
        document.body.setAttribute('data-contrast-theme', theme || 'none');
        if (theme === 'dark') {
            document.body.classList.add('contrast-theme-dark');
        } else if (theme === 'light') {
            document.body.classList.add('contrast-theme-light');
        }
    };

    // Initialize/Apply contrast theme immediately on page load
    const savedContrastTheme = getOrInitStorage('contrastTheme', 'data-contrast-theme') || 'none';
    applyContrastTheme(savedContrastTheme);

    // Setup contrast theme radio triggers on Accessibility page if they exist
    const contrastThemeRadios = document.querySelectorAll('.contrast-theme-radio');
    if (contrastThemeRadios.length > 0) {
        contrastThemeRadios.forEach(radio => {
            if (radio.value === savedContrastTheme) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                const selectedTheme = e.target.value;
                localStorage.setItem(getStorageKey('contrastTheme'), selectedTheme);
                applyContrastTheme(selectedTheme);
                syncSettingsToBackend();
            });
        });
    }

    // ── Text-to-Speech (TTS) Server-Side Controller ──

    function setButtonIconPlaying(btn) {
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (icon) {
            icon.className = "bi bi-stop-circle-fill text-danger";
        }
    }

    function resetButtonIcon(btn) {
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (icon) {
            icon.className = "bi bi-volume-up-fill text-secondary";
        }
    }

    let activeAudio = null;
    let activeTtsButton = null;
    let activeTextElement = null;
    let highlightAnimationFrameId = null;

    // Autoplay TTS state
    let isAutoplayActive = false;
    let isAutoplayPaused = false;
    let autoplayTriggers = [];
    let autoplayIndex = -1;
    let autoplayTimeoutId = null;

    Object.defineProperty(window, 'isAutoplayActive', {
        get: () => isAutoplayActive,
        set: (v) => { isAutoplayActive = v; },
        configurable: true
    });
    Object.defineProperty(window, 'isAutoplayPaused', {
        get: () => isAutoplayPaused,
        set: (v) => { isAutoplayPaused = v; },
        configurable: true
    });

    // Helper: Wrap text node words in span elements with clean word indexing
    function wrapTextInWords(element) {
        if (!element || element.getAttribute('data-original-html')) return;
        
        element.setAttribute('data-original-html', element.innerHTML);
        const text = element.textContent;
        const tokens = text.split(/(\s+)/);
        let wordIdx = 0;

        const wrappedHTML = tokens.map(token => {
            if (token.trim() === '') {
                return token;
            }
            return `<span class="tts-word" data-word-idx="${wordIdx++}">${token}</span>`;
        }).join('');

        element.innerHTML = wrappedHTML;
    }

    // Helper: Restore text to original structure
    function restoreOriginalText(element) {
        if (highlightAnimationFrameId) {
            cancelAnimationFrame(highlightAnimationFrameId);
            highlightAnimationFrameId = null;
        }
        if (!element) return;
        const originalHTML = element.getAttribute('data-original-html');
        if (originalHTML) {
            element.innerHTML = originalHTML;
            element.removeAttribute('data-original-html');
        }
    }

    // Calibrated natural speech timing model (weights syllables, stopwords, and punctuation pauses)
    function computeWordTimings(words, totalDuration, timeOffset = 0, timeSpan = totalDuration) {
        const stopwords = new Set([
            'a', 'an', 'the', 'in', 'on', 'at', 'to', 'of', 'for', 'with', 'and', 'or', 'is', 'are', 'was', 'were',
            'that', 'this', 'it', 'its', 'as', 'by', 'from', 'be', 'he', 'she', 'they', 'we', 'i', 'you', 'not', 'can',
            'ang', 'mga', 'sa', 'ng', 'na', 'ay', 'si', 'ni', 'din', 'rin', 'ito', 'at', 'o', 'kung', 'pag', 'mas', 'may', 'ko', 'mo'
        ]);

        const weights = [];
        words.forEach(el => {
            const raw = el.textContent.trim();
            const clean = raw.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '');
            let weight = 1.0;
            if (stopwords.has(clean)) {
                weight = 0.75 + clean.length * 0.08;
            } else {
                weight = 1.0 + clean.length * 0.12;
            }

            // Punctuation pauses (sentence-ending pauses take ~500ms, commas/clauses take ~250ms)
            if (/[.!?]$/.test(raw)) {
                weight += 1.6;
            } else if (/[,;:\u2014-]$/.test(raw)) {
                weight += 0.8;
            }
            weights.push(weight);
        });

        const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;
        const leadSilence = 0.04;
        const effectiveDuration = Math.max(0.1, timeSpan - leadSilence);

        let curTime = timeOffset + leadSilence;
        const intervals = [];
        for (let i = 0; i < words.length; i++) {
            const dur = (weights[i] / totalWeight) * effectiveDuration;
            intervals.push({
                start: curTime,
                end: curTime + dur
            });
            curTime += dur;
        }
        return intervals;
    }

    // Helper: Ultra-responsive 60fps animation loop tracking currentTime with calibrated phonetic word timings
    function startHighlightLoop(audio, element, spokenText) {
        if (!audio || !element) return;
        if (highlightAnimationFrameId) {
            cancelAnimationFrame(highlightAnimationFrameId);
            highlightAnimationFrameId = null;
        }

        const words = Array.from(element.querySelectorAll('.tts-word'));
        if (!words.length) return;

        // Sub-phrase ratio calculation (e.g. for quiz where only the question portion is highlighted)
        let timeOffsetRatio = 0;
        let timeSpanRatio = 1.0;
        const elClean = element.textContent.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const fullClean = (spokenText || "").trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (fullClean.length > 0 && elClean.length > 0 && fullClean !== elClean) {
            const matchIdx = fullClean.indexOf(elClean);
            if (matchIdx !== -1) {
                timeOffsetRatio = matchIdx / fullClean.length;
                timeSpanRatio = elClean.length / fullClean.length;
            }
        }

        // Clear any stale highlights in the container before starting loop
        element.querySelectorAll('.tts-highlight').forEach(el => {
            el.classList.remove('tts-highlight');
        });

        let intervals = null;
        let activeIdx = -1;
        let lastHighlightedEl = null;

        function updateHighlight() {
            if (audio.paused || audio.ended) {
                if (audio.ended) {
                    element.querySelectorAll('.tts-highlight').forEach(el => {
                        el.classList.remove('tts-highlight');
                    });
                    lastHighlightedEl = null;
                }
                cancelAnimationFrame(highlightAnimationFrameId);
                highlightAnimationFrameId = null;
                return;
            }

            const duration = audio.duration;
            const currentTime = audio.currentTime;

            if (duration && !isNaN(duration) && duration > 0) {
                if (!intervals) {
                    const spanDuration = duration * timeSpanRatio;
                    const offsetDuration = duration * timeOffsetRatio;
                    intervals = computeWordTimings(words, duration, offsetDuration, spanDuration);
                }

                let currentIdx = -1;
                for (let i = 0; i < intervals.length; i++) {
                    if (currentTime >= intervals[i].start && currentTime < intervals[i].end) {
                        currentIdx = i;
                        break;
                    }
                }

                // If audio just started (within initial ~50ms lead), highlight word 0 immediately (zero latency)
                if (currentIdx === -1 && currentTime > 0 && currentTime < intervals[0].start) {
                    currentIdx = 0;
                }

                // If audio is at the end of the text segment, keep the last word highlighted until pause/end
                if (currentIdx === -1 && intervals.length > 0 && currentTime >= intervals[intervals.length - 1].start && currentTime <= duration) {
                    currentIdx = intervals.length - 1;
                }

                if (currentIdx !== activeIdx) {
                    // Strictly purge all existing highlights in the element to prevent any left-behind spans
                    element.querySelectorAll('.tts-highlight').forEach(el => {
                        el.classList.remove('tts-highlight');
                    });

                    if (currentIdx >= 0 && currentIdx < words.length) {
                        words[currentIdx].classList.add('tts-highlight');
                        lastHighlightedEl = words[currentIdx];
                    } else {
                        lastHighlightedEl = null;
                    }
                    activeIdx = currentIdx;
                }
            }

            highlightAnimationFrameId = requestAnimationFrame(updateHighlight);
        }

        highlightAnimationFrameId = requestAnimationFrame(updateHighlight);
    }

    // Autoplay TTS functionality
    function triggerNextAutoplay() {
        if (!isAutoplayActive || isAutoplayPaused) return;

        autoplayIndex++;
        autoplayTriggers = Array.from(document.querySelectorAll('.tts-trigger'));
        if (autoplayIndex >= autoplayTriggers.length) {
            window.stopAutoplay();
            return;
        }

        const nextTrigger = autoplayTriggers[autoplayIndex];
        const text = nextTrigger.getAttribute('data-tts-text') || '';

        // If the screen reader toggle is off, stop autoplay immediately
        const isTtsEnabled = document.body.getAttribute('data-tts') !== 'off';
        if (!isTtsEnabled) {
            window.stopAutoplay();
            return;
        }

        window.speakText(text, nextTrigger, true);
    }

    function speakCurrentAutoplayCard() {
        if (!isAutoplayActive || isAutoplayPaused) return;

        autoplayTriggers = Array.from(document.querySelectorAll('.tts-trigger'));
        if (autoplayIndex < 0 || autoplayIndex >= autoplayTriggers.length) {
            autoplayIndex = 0;
        }
        if (autoplayIndex >= autoplayTriggers.length) {
            window.stopAutoplay();
            return;
        }

        const currentTrigger = autoplayTriggers[autoplayIndex];
        const text = currentTrigger.getAttribute('data-tts-text') || '';
        window.speakText(text, currentTrigger, true);
    }

    window.startAutoplay = function() {
        isAutoplayActive = true;
        isAutoplayPaused = false;
        autoplayTriggers = Array.from(document.querySelectorAll('.tts-trigger'));
        if (autoplayTriggers.length === 0) return;

        // If resuming or starting from a valid card
        if (autoplayIndex < 0 || autoplayIndex >= autoplayTriggers.length) {
            autoplayIndex = -1;
            updateAutoplayUI('playing');
            triggerNextAutoplay();
        } else {
            updateAutoplayUI('playing');
            speakCurrentAutoplayCard();
        }
    };

    window.pauseAutoplay = function() {
        if (!isAutoplayActive) return;
        isAutoplayPaused = true;

        if (autoplayTimeoutId) {
            clearTimeout(autoplayTimeoutId);
            autoplayTimeoutId = null;
        }

        if (activeAudio && !activeAudio.paused) {
            activeAudio.pause();
        }
        if (activeTtsButton) {
            resetButtonIcon(activeTtsButton);
        }

        updateAutoplayUI('paused');
    };

    window.resumeAutoplay = function() {
        if (!isAutoplayActive) {
            window.startAutoplay();
            return;
        }

        isAutoplayPaused = false;
        updateAutoplayUI('playing');

        // If existing audio was paused mid-stream, resume it!
        if (activeAudio && activeAudio.paused && activeAudio.currentTime > 0 && !activeAudio.ended) {
            if (activeTtsButton) {
                setButtonIconPlaying(activeTtsButton);
            }
            activeAudio.play().catch(err => {
                console.warn("[Autoplay Resume Play Error]", err);
                speakCurrentAutoplayCard();
            });
            return;
        }

        speakCurrentAutoplayCard();
    };

    window.stopAutoplay = function() {
        isAutoplayActive = false;
        isAutoplayPaused = false;
        autoplayIndex = -1;
        autoplayTriggers = [];
        
        if (autoplayTimeoutId) {
            clearTimeout(autoplayTimeoutId);
            autoplayTimeoutId = null;
        }

        if (activeAudio) {
            activeAudio.pause();
            if (activeTtsButton) {
                resetButtonIcon(activeTtsButton);
            }
            if (activeTextElement) {
                restoreOriginalText(activeTextElement);
            }
            activeAudio = null;
            activeTtsButton = null;
            activeTextElement = null;
        }

        updateAutoplayUI('stopped');
    };

    window.toggleAutoplay = function() {
        if (isAutoplayActive && !isAutoplayPaused) {
            window.pauseAutoplay();
        } else if (isAutoplayActive && isAutoplayPaused) {
            window.resumeAutoplay();
        } else {
            window.startAutoplay();
        }
    };

    function updateAutoplayUI(state) {
        const isPlaying = state === 'playing' || state === true;
        const isPaused = state === 'paused';

        const buttons = document.querySelectorAll('.btn-autoplay-tts, #btn-autoplay-tts-floating');
        buttons.forEach(btn => {
            const icon = btn.querySelector('i');
            const textSpan = btn.querySelector('.autoplay-text-span');

            if (isPlaying) {
                btn.classList.remove('btn-outline-primary');
                btn.classList.add('btn-danger');
                if (icon) icon.className = "bi bi-stop-circle-fill";
                if (textSpan) textSpan.textContent = "Stop Auto Play";
                btn.setAttribute('aria-label', "Stop Auto Play");
            } else if (isPaused) {
                btn.classList.remove('btn-danger');
                btn.classList.add('btn-outline-primary');
                if (icon) icon.className = "bi bi-play-circle-fill";
                if (textSpan) textSpan.textContent = "Resume Auto Play";
                btn.setAttribute('aria-label', "Resume Auto Play");
            } else {
                btn.classList.remove('btn-danger');
                btn.classList.add('btn-outline-primary');
                if (icon) icon.className = "bi bi-play-circle-fill";
                if (textSpan) textSpan.textContent = "Auto Play TTS";
                btn.setAttribute('aria-label', "Auto Play TTS");
            }
        });
    }

    window.speakText = function(text, btnElement, autoPlay = false) {
        // Guard: Do not play speech if the user has disabled the screen_reader/TTS feature
        const isTtsEnabled = document.body.getAttribute('data-tts') !== 'off';
        if (!isTtsEnabled) {
            console.warn("[TTS Warning] Text-to-Speech is toggled OFF in accessibility settings.");
            return;
        }

        // If autoplay is active and the user manually clicked a different card, update autoplay to that card
        if (isAutoplayActive && btnElement) {
            autoplayTriggers = Array.from(document.querySelectorAll('.tts-trigger'));
            const clickedIdx = autoplayTriggers.indexOf(btnElement);
            if (clickedIdx !== -1) {
                autoplayIndex = clickedIdx;
                isAutoplayPaused = false;
                updateAutoplayUI('playing');
            }
        }

        // Toggle behavior: If the active audio is playing and we click the same button, pause it
        if (activeAudio && activeTtsButton === btnElement && !activeAudio.paused) {
            if (isAutoplayActive) {
                window.pauseAutoplay();
                return;
            }
            activeAudio.pause();
            resetButtonIcon(btnElement);
            if (window.TelemetryTracker && window.TelemetryTracker.trackTTSPause) {
                window.TelemetryTracker.trackTTSPause();
            }
            return;
        }

        // Resume behavior: If the active audio is paused and we click the same button, resume it
        if (activeAudio && activeTtsButton === btnElement && activeAudio.paused) {
            if (isAutoplayActive) {
                window.resumeAutoplay();
                return;
            }
            setButtonIconPlaying(btnElement);
            activeAudio.play().catch(err => console.warn(err));
            return;
        }

        // Cancel previous speech/audio playback and restore original text
        if (activeAudio) {
            activeAudio.pause();
            if (activeTtsButton) {
                resetButtonIcon(activeTtsButton);
            }
            if (activeTextElement) {
                restoreOriginalText(activeTextElement);
            }
        }

        if (!text || !text.trim()) return;

        // Resolve target text element for phonetic highlighting
        let targetTextEl = null;
        if (btnElement) {
            const panel = btnElement.closest(".flashcard-panel-top, .flashcard-panel-bottom, .flashcard-panel-descriptive");
            if (panel) {
                targetTextEl = panel.querySelector(".flashcard-text-title, .flashcard-text-body, .flashcard-text-descriptive");
            } else if (btnElement.id === 'btn-quiz-tts') {
                targetTextEl = document.getElementById('question-text');
            }
        }

        if (targetTextEl) {
            wrapTextInWords(targetTextEl);
            activeTextElement = targetTextEl;

            // Handle Auto Scroll behavior if toggled ON
            const isAutoScrollEnabled = document.body.getAttribute('data-auto-scroll') === 'on';
            if (isAutoScrollEnabled && btnElement) {
                const cardItem = btnElement.closest('.flashcard-item');
                if (cardItem) {
                    cardItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else if (btnElement.id === 'btn-quiz-tts') {
                    const quizContainer = document.querySelector('.quiz-question-card');
                    if (quizContainer) {
                        quizContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        }

        // Detect language (English vs Filipino/Tagalog) accurately based on study content context
        function detectLearningLanguage(textToSpeak, triggerBtn) {
            // Unambiguous Filipino/Tagalog grammatical stopwords and markers
            const tagalogStopwords = new Set([
                "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "kanino", 
                "nito", "niyan", "noon", "nila", "natin", "ninyo", "lahat", "isang", 
                "dahil", "kung", "kapag", "upang", "wika", "filipino", "pilipino", 
                "ito", "sila", "tayo", "kami", "kayo", "siya", "aking", "iyong", 
                "kanilang", "nating", "tungkol", "ay", "bawat", "maging", "naman", 
                "lamang", "pangunahing", "sagot", "tanong", "talata", "pangungusap",
                "sa", "ng", "na", "alin", "sino", "ilan", "ilang", "wala", "walang",
                "mayroon", "meron", "din", "rin", "ni", "lang"
            ]);

            // Core English grammatical stopwords and question words
            const englishStopwords = new Set([
                "the", "is", "are", "was", "were", "what", "which", "where", "who", "whom",
                "whose", "how", "why", "when", "in", "on", "of", "for", "with", "about",
                "from", "by", "an", "this", "that", "these", "those", "have", "has", "had",
                "can", "could", "will", "would", "should", "their", "there", "they", "its",
                "country", "largest", "world", "size", "capital", "city", "process", "energy"
            ]);

            const getScores = (t) => {
                const tokens = (t || "").toLowerCase().match(/\b[a-z\u00C0-\u024F\u1E00-\u1EFF]+\b/g) || [];
                let tlScore = 0;
                let enScore = 0;
                tokens.forEach(tok => {
                    if (tagalogStopwords.has(tok)) tlScore++;
                    if (englishStopwords.has(tok)) enScore++;
                });
                return { tlScore, enScore };
            };

            // First check if the text to speak has a clear language signal
            const speakScores = getScores(textToSpeak);
            if (speakScores.tlScore >= 2 && speakScores.tlScore > speakScores.enScore) {
                return 'tl';
            }
            if (speakScores.tlScore >= 1 && speakScores.enScore === 0) {
                return 'tl';
            }
            if (speakScores.enScore >= 2 && speakScores.enScore > speakScores.tlScore) {
                return 'en';
            }
            if (speakScores.enScore >= 1 && speakScores.tlScore === 0) {
                return 'en';
            }

            // If ambiguous or low signal, fallback to card/page context
            let contextText = textToSpeak || "";
            if (triggerBtn) {
                const cardItem = triggerBtn.closest('.flashcard-item');
                if (cardItem) {
                    contextText = cardItem.innerText || contextText;
                } else {
                    const mainContent = document.querySelector('.quiz-screen, .deck-cards-stack, main, .quiz-question-card');
                    if (mainContent) {
                        contextText = mainContent.innerText || contextText;
                    }
                }
            }

            const contextScores = getScores(contextText);
            if (contextScores.tlScore >= 2 && contextScores.tlScore > contextScores.enScore) {
                return 'tl';
            }
            if (contextScores.tlScore >= 1 && contextScores.enScore === 0) {
                return 'tl';
            }
            return 'en';
        }

        const lang = detectLearningLanguage(text, btnElement);
        console.log(`[TTS Debug] Server-side speech requested (lang=${lang}) for: "${text.substring(0, 40)}..."`);

        // Construct backend endpoint URL with voice ID selection
        const engineId = localStorage.getItem(getStorageKey('ttsEngine')) || 'azure';
        const voiceId = localStorage.getItem(getStorageKey('ttsVoice')) || 'en-US-AvaNeural';
        const audioUrl = `/api/tts?text=${encodeURIComponent(text)}&lang=${lang}&engine=${engineId}&voice=${voiceId}`;
        const audio = new Audio(audioUrl);
        activeAudio = audio;
        activeTtsButton = btnElement;

        // Apply dynamic TTS speed settings and lock playbackRate on stream load events
        const bodyTtsRate = parseFloat(document.body.getAttribute('data-tts-rate')) || 1.0;
        audio.defaultPlaybackRate = bodyTtsRate;
        audio.playbackRate = bodyTtsRate;

        audio.addEventListener("loadedmetadata", () => {
            audio.playbackRate = bodyTtsRate;
        });

        // Hook HTML5 Audio events to our UI and Telemetry
        const handlePlaybackStart = () => {
            audio.playbackRate = bodyTtsRate;
            setButtonIconPlaying(btnElement);
            if (targetTextEl) {
                if (!targetTextEl.querySelector('.tts-word')) {
                    wrapTextInWords(targetTextEl);
                }
                startHighlightLoop(audio, targetTextEl, text);
            }
        };

        audio.addEventListener("play", () => {
            handlePlaybackStart();
            if (window.TelemetryTracker && window.TelemetryTracker.trackTTSPlay) {
                window.TelemetryTracker.trackTTSPlay();
            }
        });

        audio.addEventListener("pause", () => {
            resetButtonIcon(btnElement);
            if (window.TelemetryTracker && window.TelemetryTracker.trackTTSPause) {
                window.TelemetryTracker.trackTTSPause();
            }
        });

        audio.addEventListener("ended", () => {
            resetButtonIcon(btnElement);
            if (targetTextEl) {
                restoreOriginalText(targetTextEl);
            }
            if (activeAudio === audio) {
                activeAudio = null;
                activeTtsButton = null;
                activeTextElement = null;
            }

            // Hook: Autoplay progression
            if (isAutoplayActive && !isAutoplayPaused) {
                autoplayTimeoutId = setTimeout(() => {
                    triggerNextAutoplay();
                }, 800);
            }
        });

        audio.addEventListener("error", (e) => {
            console.error("[TTS Server Error] Audio load failed:", e);
            resetButtonIcon(btnElement);
            if (targetTextEl) {
                restoreOriginalText(targetTextEl);
            }
            if (activeAudio === audio) {
                activeAudio = null;
                activeTtsButton = null;
                activeTextElement = null;
            }

            // Hook: Autoplay progression on error
            if (isAutoplayActive && !isAutoplayPaused) {
                autoplayTimeoutId = setTimeout(() => {
                    triggerNextAutoplay();
                }, 800);
            }
        });

        // Trigger playback
        audio.play().catch(err => {
            console.error("[TTS Playback Error]", err);
            resetButtonIcon(btnElement);
            if (targetTextEl) {
                restoreOriginalText(targetTextEl);
            }
            // Hook: Autoplay progression on play error
            if (isAutoplayActive && !isAutoplayPaused) {
                autoplayTimeoutId = setTimeout(() => {
                    triggerNextAutoplay();
                }, 800);
            }
        });
    };

    // Bind document listener for Flashcard list buttons
    document.addEventListener("click", (e) => {
        const trigger = e.target.closest(".tts-trigger");
        if (trigger) {
            e.preventDefault();
            const text = trigger.getAttribute("data-tts-text") || "";
            if (text && text.trim()) {
                window.speakText(text, trigger);
            }
        }
    });

    // ── Agency Controller Event Bindings (Floating Action Button & Card) ──
    const agencySnackbar = document.getElementById("ai-rec-widget") || document.getElementById("agency-snackbar");
    const recExpandCard = document.getElementById("rec-expand-card");
    const btnRecFab = document.getElementById("btn-rec-fab");
    const btnAgencyAccept = document.getElementById("btn-agency-accept");
    const btnAgencyDecline = document.getElementById("btn-agency-decline");
    const btnAgencyClose = document.getElementById("btn-agency-close");
    const chkAgencyDontShow = document.getElementById("chk-agency-dont-show");

    let recSignature = "";
    if (btnAgencyAccept) {
        recSignature = btnAgencyAccept.getAttribute("data-pending-settings") || "";
    }

    // Hide widget immediately if ignored or silenced for this session
    if (agencySnackbar) {
        const isSilenced = sessionStorage.getItem("silence_ai_recommendations") === "true";
        const ignoredRec = sessionStorage.getItem("ignored_ai_recommendation");
        if (isSilenced || (recSignature && ignoredRec === recSignature)) {
            agencySnackbar.style.display = "none";
        }
    }

    // Toggle Expandable Recommendation Card on FAB click
    if (btnRecFab && recExpandCard) {
        btnRecFab.addEventListener("click", (e) => {
            e.stopPropagation();
            const isHidden = recExpandCard.classList.contains("d-none");
            if (isHidden) {
                recExpandCard.classList.remove("d-none");
                btnRecFab.classList.add("d-none");
                btnRecFab.setAttribute("aria-expanded", "true");
            } else {
                recExpandCard.classList.add("d-none");
                btnRecFab.classList.remove("d-none");
                btnRecFab.setAttribute("aria-expanded", "false");
            }
        });

        // Close card if user clicks outside the widget
        document.addEventListener("click", (e) => {
            if (agencySnackbar && !agencySnackbar.contains(e.target) && !recExpandCard.classList.contains("d-none")) {
                recExpandCard.classList.add("d-none");
                btnRecFab.classList.remove("d-none");
                btnRecFab.setAttribute("aria-expanded", "false");
            }
        });
    }

    function dismissSnackbar() {
        if (chkAgencyDontShow && chkAgencyDontShow.checked) {
            sessionStorage.setItem("silence_ai_recommendations", "true");
        }
        if (agencySnackbar) {
            agencySnackbar.classList.add("fade-out");
            setTimeout(() => {
                agencySnackbar.style.display = "none";
            }, 300);
        }
    }

    if (agencySnackbar) {
        if (btnAgencyClose) {
            btnAgencyClose.addEventListener("click", (e) => {
                e.stopPropagation();
                if (chkAgencyDontShow && chkAgencyDontShow.checked) {
                    dismissSnackbar();
                } else if (recExpandCard) {
                    recExpandCard.classList.add("d-none");
                    if (btnRecFab) {
                        btnRecFab.classList.remove("d-none");
                        btnRecFab.setAttribute("aria-expanded", "false");
                    }
                } else {
                    dismissSnackbar();
                }
            });
        }

        if (btnAgencyDecline) {
            btnAgencyDecline.addEventListener("click", () => {
                if (chkAgencyDontShow && chkAgencyDontShow.checked && recSignature) {
                    sessionStorage.setItem("ignored_ai_recommendation", recSignature);
                }
                dismissSnackbar();
                fetch("/api/settings/decline", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Requested-With": "XMLHttpRequest"
                    }
                })
                .then(res => res.json())
                .then(data => {
                    console.log("[Agency] Decline feedback sent to server:", data);
                })
                .catch(err => console.error("[Agency Error] Decline failed:", err));
            });
        }

        if (btnAgencyAccept && btnAgencyAccept.getAttribute("data-pending-settings")) {
            btnAgencyAccept.addEventListener("click", () => {
                dismissSnackbar();
                try {
                    const pendingRaw = btnAgencyAccept.getAttribute("data-pending-settings");
                    const pending = JSON.parse(pendingRaw);
                    
                    // 1. Instantly apply layout modifications on client-side (no reload required)
                    if (pending.text_size) {
                        localStorage.setItem(getStorageKey('textSize'), pending.text_size);
                        // Check corresponding radio button in UI if it exists
                        const radio = document.querySelector(`.text-size-radio[value="${pending.text_size}"]`);
                        if (radio) {
                            radio.checked = true;
                        }
                    }

                    if (pending.line_focus) {
                        const val = pending.line_focus === 'on' ? '1' : '0';
                        localStorage.setItem(getStorageKey('access_line_focus'), val);
                        document.body.setAttribute('data-line-focus', pending.line_focus);
                        // Toggle switch in UI if it exists
                        const sw = document.getElementById('switchLineFocus');
                        if (sw) {
                            sw.checked = (val === '1');
                        }
                    }

                    if (pending.auto_scroll) {
                        const val = pending.auto_scroll === 'on' ? '1' : '0';
                        localStorage.setItem(getStorageKey('access_auto_scroll'), val);
                        document.body.setAttribute('data-auto-scroll', pending.auto_scroll);
                        // Toggle switch in UI if it exists
                        const sw = document.getElementById('switchAutoScroll');
                        if (sw) {
                            sw.checked = (val === '1');
                        }
                    }

                    if (pending.tts) {
                        const val = pending.tts === 'on' ? '1' : '0';
                        localStorage.setItem(getStorageKey('access_tts'), val);
                        document.body.setAttribute('data-tts', pending.tts);
                        // Toggle switch in UI if it exists
                        const sw = document.getElementById('switchTts');
                        if (sw) {
                            sw.checked = (val === '1');
                        }
                        applyTtsVisibility();
                    }

                    if (pending.content_level) {
                        localStorage.setItem(getStorageKey('contentLevel'), pending.content_level);
                        document.body.setAttribute('data-content-level', pending.content_level);
                        // Check corresponding radio button in UI if it exists
                        const radio = document.querySelector(`.content-level-radio[value="${pending.content_level.toLowerCase()}"]`);
                        if (radio) {
                            radio.checked = true;
                        }
                    }

                    // Trigger visual refresh of spacing dynamically
                    if (typeof applyTextModifications === "function") {
                        applyTextModifications();
                    }

                    // 2. Dispatch save to backend
                    fetch("/api/settings/accept", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Requested-With": "XMLHttpRequest"
                        }
                    })
                    .then(res => res.json())
                    .then(data => {
                        console.log("[Agency] Accept feedback sent to server:", data);
                    })
                    .catch(err => console.error("[Agency Error] Accept failed:", err));

                    sessionStorage.removeItem("ignored_ai_recommendation");
                } catch (e) {
                    console.error("[Agency Error] Parsing pending settings failed:", e);
                }
            });
        }

        // Clear session token when user logs out
        const logoutLink = document.querySelector('a[href="/logout"]');
        if (logoutLink) {
            logoutLink.addEventListener("click", () => {
                sessionStorage.removeItem("ignored_ai_recommendation");
            });
        }
    }

    // ── Global Clean Logout Handler ──
    const btnConfirmLogout = document.getElementById('btnConfirmLogout');
    if (btnConfirmLogout) {
        btnConfirmLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // 1. Sign out Firebase Client if active
            if (window.firebase && typeof firebase.auth === 'function') {
                try {
                    await firebase.auth().signOut();
                } catch (fbErr) {
                    console.warn('[Logout] Firebase signOut warning:', fbErr);
                }
            }

            // 2. Clear session-specific flags
            sessionStorage.removeItem("silence_ai_recommendations");
            sessionStorage.removeItem("ignored_ai_recommendation");

            // 3. Navigate cleanly to backend logout route which clears Flask session and redirects to /auth
            window.location.href = '/logout';
        });
    }

    // ── Line Focus Cursor Tracking with Magnetic Snapping ──
    const getFocusYWithSnapping = (clientY) => {
        const isMagnetic = localStorage.getItem(getStorageKey('magnetic_ruler')) === '1';
        if (!isMagnetic) {
            return clientY;
        }

        const targets = document.querySelectorAll(
            '.flashcard-panel-top, .flashcard-panel-bottom, .quiz-question-card, .btn-quiz-option, .flashcard-item'
        );
        let closestTarget = null;
        let minDistance = Infinity;

        targets.forEach(target => {
            const rect = target.getBoundingClientRect();
            if (rect.height > 0 && rect.width > 0) {
                const centerY = rect.top + rect.height / 2;
                const dist = Math.abs(clientY - centerY);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestTarget = target;
                }
            }
        });

        if (closestTarget && minDistance < 150) {
            const rect = closestTarget.getBoundingClientRect();
            return rect.top + rect.height / 2;
        }

        return clientY;
    };

    const handleLineFocusMouseMove = (e) => {
        const page = document.body.getAttribute('data-page');
        const isDecksArea = ['flashcard', 'flashcard_deck', 'quiz_deck'].includes(page);
        if (isDecksArea && document.body.getAttribute('data-line-focus') === 'on') {
            const focusY = getFocusYWithSnapping(e.clientY);
            document.documentElement.style.setProperty('--focus-y', `${focusY}px`);
        }
    };

    const handleLineFocusTouchMove = (e) => {
        const page = document.body.getAttribute('data-page');
        const isDecksArea = ['flashcard', 'flashcard_deck', 'quiz_deck'].includes(page);
        if (isDecksArea && document.body.getAttribute('data-line-focus') === 'on' && e.touches.length > 0) {
            const touch = e.touches[0];
            const focusY = getFocusYWithSnapping(touch.clientY);
            document.documentElement.style.setProperty('--focus-y', `${focusY}px`);
        }
    };

    document.addEventListener('mousemove', handleLineFocusMouseMove);
    document.addEventListener('touchmove', handleLineFocusTouchMove, { passive: true });

    // ── Sidebar Deck Ticker Carousel Animation ──
    const initSidebarDeckTicker = () => {
        const slides = document.querySelectorAll('.ticker-slide');
        if (slides.length <= 1) return;

        let currentIdx = 0;
        setInterval(() => {
            const currentSlide = slides[currentIdx];
            currentSlide.classList.remove('active');
            currentSlide.classList.add('slide-out');

            currentIdx = (currentIdx + 1) % slides.length;
            const nextSlide = slides[currentIdx];
            nextSlide.classList.remove('slide-out');
            nextSlide.classList.add('active');

            setTimeout(() => {
                currentSlide.classList.remove('slide-out');
            }, 600); // matches CSS transition time (0.6s)
        }, 3500); // cycle every 3.5 seconds
    };

    initSidebarDeckTicker();

    // ── Keyboard Navigation & Hotkeys Support ──
    const navigateFlashcardScroll = (direction) => {
        const cards = document.querySelectorAll('.flashcard-item');
        if (cards.length === 0) return;

        let minDistance = Infinity;
        let closestIdx = 0;
        const viewportCenter = window.innerHeight / 2;

        cards.forEach((card, idx) => {
            const rect = card.getBoundingClientRect();
            const cardCenter = (rect.top + rect.bottom) / 2;
            const dist = Math.abs(cardCenter - viewportCenter);
            if (dist < minDistance) {
                minDistance = dist;
                closestIdx = idx;
            }
        });

        let targetIdx = closestIdx + direction;
        if (targetIdx < 0) targetIdx = 0;
        if (targetIdx >= cards.length) targetIdx = cards.length - 1;

        cards[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Highlight card briefly to give visual feedback
        cards[targetIdx].style.outline = "3px solid #5671C9";
        cards[targetIdx].style.outlineOffset = "4px";
        setTimeout(() => {
            cards[targetIdx].style.outline = "none";
        }, 800);
    };

    const triggerActiveTTS = () => {
        const page = document.body.getAttribute('data-page');
        if (page === 'flashcard_deck') {
            // Priority 1: If speech is currently playing, PAUSE it!
            if (activeAudio && !activeAudio.paused) {
                if (isAutoplayActive) {
                    window.pauseAutoplay();
                } else {
                    activeAudio.pause();
                    if (activeTtsButton) resetButtonIcon(activeTtsButton);
                }
                return;
            }

            // Priority 2: If autoplay is in paused state, RESUME it!
            if (isAutoplayActive && isAutoplayPaused) {
                window.resumeAutoplay();
                return;
            }

            // Priority 3: If single audio is paused, resume playback
            if (activeAudio && activeAudio.paused && activeAudio.currentTime > 0 && !activeAudio.ended) {
                activeAudio.play().catch(err => console.warn(err));
                if (activeTtsButton) setButtonIconPlaying(activeTtsButton);
                return;
            }

            // Priority 4: No active/paused audio. Speak the currently active or nearest visible card.
            const cards = document.querySelectorAll('.flashcard-item');
            if (cards.length === 0) return;

            let targetCard = null;
            if (document.activeElement && document.activeElement.closest('.flashcard-item')) {
                targetCard = document.activeElement.closest('.flashcard-item');
            }

            if (!targetCard && isAutoplayActive && autoplayIndex >= 0 && autoplayIndex < cards.length) {
                targetCard = cards[autoplayIndex];
            }

            if (!targetCard) {
                const viewportCenter = window.innerHeight / 2;
                let minDistance = Infinity;

                cards.forEach(card => {
                    const rect = card.getBoundingClientRect();
                    // Card must be at least partially visible in viewport
                    if (rect.bottom > 80 && rect.top < window.innerHeight) {
                        const cardCenter = (rect.top + rect.bottom) / 2;
                        const dist = Math.abs(cardCenter - viewportCenter);
                        if (dist < minDistance) {
                            minDistance = dist;
                            targetCard = card;
                        }
                    }
                });
            }

            if (!targetCard && cards.length > 0) {
                targetCard = cards[0];
            }

            if (targetCard) {
                const trigger = targetCard.querySelector('.tts-trigger');
                if (trigger) trigger.click();
            }
        } else if (page === 'quiz_deck') {
            if (activeAudio && !activeAudio.paused) {
                activeAudio.pause();
                if (activeTtsButton) resetButtonIcon(activeTtsButton);
                return;
            }
            if (activeAudio && activeAudio.paused && activeAudio.currentTime > 0 && !activeAudio.ended) {
                activeAudio.play().catch(err => console.warn(err));
                if (activeTtsButton) setButtonIconPlaying(activeTtsButton);
                return;
            }
            const quizTtsBtn = document.getElementById('btn-quiz-tts');
            if (quizTtsBtn) quizTtsBtn.click();
        }
    };

    // ── Context-Aware Smart Navigation & Spatial Controller ──
    const handleContextualControl = (activeEl, keyName, e) => {
        if (!activeEl || activeEl === document.body) return false;

        // 1. Range Sliders (Speech Speed / Tempo)
        // Left/Right adjust tempo; Up/Down leave the control to navigate settings
        if (activeEl.tagName === 'INPUT' && activeEl.type === 'range') {
            const step = parseFloat(activeEl.step) || 0.05;
            const min = parseFloat(activeEl.min) || 0.5;
            const max = parseFloat(activeEl.max) || 2.0;
            let currentVal = parseFloat(activeEl.value) || 1.0;

            if (keyName === 'ArrowLeft') {
                if (e) e.preventDefault();
                currentVal = Math.max(min, Math.round((currentVal - step) * 100) / 100);
                activeEl.value = currentVal;
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            } else if (keyName === 'ArrowRight') {
                if (e) e.preventDefault();
                currentVal = Math.min(max, Math.round((currentVal + step) * 100) / 100);
                activeEl.value = currentVal;
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }

        // 2. Select Dropdowns (Font Style, Engine, Voices)
        // Left/Right change choice; Space/Enter open; Up/Down navigate smoothly out
        if (activeEl.tagName === 'SELECT') {
            if (keyName === 'ArrowLeft' || keyName === 'ArrowRight') {
                if (e) e.preventDefault();
                const delta = keyName === 'ArrowRight' ? 1 : -1;
                const newIdx = Math.max(0, Math.min(activeEl.options.length - 1, activeEl.selectedIndex + delta));
                if (newIdx !== activeEl.selectedIndex) {
                    activeEl.selectedIndex = newIdx;
                    activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return true;
            }
        }

        // 3. Radio Buttons (Text Size, Kerning, Spacing, Contrast, Reading Level)
        // Left/Right cycle options; Up/Down leave group to navigate to other settings
        if (activeEl.tagName === 'INPUT' && activeEl.type === 'radio') {
            const groupName = activeEl.name;
            const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${groupName}"]`));
            const currentIdx = radios.indexOf(activeEl);

            if (keyName === 'ArrowRight') {
                if (e) e.preventDefault();
                const nextIdx = (currentIdx + 1) % radios.length;
                radios[nextIdx].checked = true;
                radios[nextIdx].focus();
                radios[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                radios[nextIdx].dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            } else if (keyName === 'ArrowLeft') {
                if (e) e.preventDefault();
                const prevIdx = (currentIdx - 1 + radios.length) % radios.length;
                radios[prevIdx].checked = true;
                radios[prevIdx].focus();
                radios[prevIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                radios[prevIdx].dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }

        // 4. Toggle Switches (Checkboxes, Custom Switches)
        if (activeEl.tagName === 'INPUT' && activeEl.type === 'checkbox') {
            if (keyName === 'Space' || keyName === 'Enter') {
                if (e) e.preventDefault();
                activeEl.checked = !activeEl.checked;
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }

        // 5. Accordion Drawer Links (ONLY actual collapse toggle triggers)
        const accordionToggle = activeEl.matches('a[data-bs-toggle="collapse"], button[data-bs-toggle="collapse"]') ? activeEl : null;
        if (accordionToggle) {
            const targetSelector = accordionToggle.getAttribute('href') || accordionToggle.getAttribute('data-bs-target');
            const collapseTarget = targetSelector ? document.querySelector(targetSelector) : null;
            if (collapseTarget) {
                const isExpanded = collapseTarget.classList.contains('show');

                if (keyName === 'Space' || keyName === 'Enter') {
                    if (e) e.preventDefault();
                    accordionToggle.click();
                    return true;
                } else if (keyName === 'ArrowRight' && !isExpanded) {
                    if (e) e.preventDefault();
                    accordionToggle.click();
                    return true;
                } else if (keyName === 'ArrowLeft' && isExpanded) {
                    if (e) e.preventDefault();
                    accordionToggle.click();
                    return true;
                }
            }
        }

        return false;
    };

    const getVisibleFocusableElements = () => {
        return Array.from(document.querySelectorAll(
            'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="switch"]'
        )).filter(el => {
            if (el.disabled || el.classList.contains('disabled')) return false;
            // Check if element or parent is collapsed / invisible
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
        });
    };

    const getFirstVisibleElementInViewport = (elements) => {
        // Find visible elements currently on screen in the user's POV
        const inViewport = elements.filter(el => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.top <= window.innerHeight && r.bottom >= 0;
        });

        if (inViewport.length > 0) {
            // Sort by top distance to pick the top-most visible element on screen
            inViewport.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            return inViewport[0];
        }

        return elements[0] || null;
    };

    const spatialNavigation = (key) => {
        const activeEl = document.activeElement;
        const focusableElements = getVisibleFocusableElements();

        if (focusableElements.length === 0) return;

        // Default to the top-most visible element in the user's current POV
        if (!activeEl || activeEl === document.body) {
            const startEl = getFirstVisibleElementInViewport(focusableElements);
            if (startEl) {
                startEl.focus();
                startEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        const currentIdx = focusableElements.indexOf(activeEl);

        // Linear Smart Traversal for Vertical navigation (Up / Down)
        if (key === 'ArrowDown') {
            if (currentIdx >= 0 && currentIdx < focusableElements.length - 1) {
                const nextEl = focusableElements[currentIdx + 1];
                nextEl.focus();
                nextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            } else if (currentIdx === -1) {
                const startEl = getFirstVisibleElementInViewport(focusableElements);
                if (startEl) {
                    startEl.focus();
                    startEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return;
            }
        } else if (key === 'ArrowUp') {
            if (currentIdx > 0) {
                const prevEl = focusableElements[currentIdx - 1];
                prevEl.focus();
                prevEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            } else if (currentIdx === -1) {
                const startEl = getFirstVisibleElementInViewport(focusableElements);
                if (startEl) {
                    startEl.focus();
                    startEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                return;
            }
        }

        // 2D Geometric search for Horizontal navigation (ArrowLeft / ArrowRight)
        const activeRect = activeEl.getBoundingClientRect();
        const activeCenterX = activeRect.left + activeRect.width / 2;
        const activeCenterY = activeRect.top + activeRect.height / 2;

        let bestElement = null;
        let bestMetric = Infinity;

        focusableElements.forEach(el => {
            if (el === activeEl) return;
            const rect = el.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const dx = centerX - activeCenterX;
            const dy = centerY - activeCenterY;

            let isValidDirection = false;
            if (key === 'ArrowRight') {
                if (dx > 5 && Math.abs(dy) < Math.abs(dx) * 1.8) isValidDirection = true;
            } else if (key === 'ArrowLeft') {
                if (dx < -5 && Math.abs(dy) < Math.abs(dx) * 1.8) isValidDirection = true;
            }

            if (isValidDirection) {
                const dist = dx * dx + dy * dy;
                if (dist < bestMetric) {
                    bestMetric = dist;
                    bestElement = el;
                }
            }
        });

        if (bestElement) {
            bestElement.focus();
            bestElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (key === 'ArrowRight' && currentIdx >= 0 && currentIdx < focusableElements.length - 1) {
            const nextEl = focusableElements[currentIdx + 1];
            nextEl.focus();
            nextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (key === 'ArrowLeft' && currentIdx > 0) {
            const prevEl = focusableElements[currentIdx - 1];
            prevEl.focus();
            prevEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    };

    const handleKeyboardNavigation = (e) => {
        // Respect already handled / default-prevented events
        if (e.defaultPrevented) return;

        // The auth page has its own dedicated, WCAG-compliant form controller
        const page = document.body.getAttribute('data-page');
        if (page === 'auth') return;

        // Read active state (defaults to true if null/unregistered)
        const hotkeysAttr = document.body.getAttribute('data-hotkeys');
        const isHotkeysEnabled = hotkeysAttr !== 'off';
        if (!isHotkeysEnabled) return;

        const activeEl = document.activeElement;

        // Allow user to record hotkeys without firing navigation
        if (activeEl && activeEl.classList.contains('hotkey-input')) {
            return;
        }

        // Prevent shortcut activation if user is typing in standard text inputs
        const isTextInputActive = activeEl && (
            (activeEl.tagName === 'INPUT' && ['text', 'email', 'password', 'search', 'number', 'tel', 'url'].includes(activeEl.type)) || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable
        );
        if (isTextInputActive) return;

        // Build combination string matching the recorder format
        let modifiers = [];
        if (e.altKey) modifiers.push('Alt');
        if (e.ctrlKey) modifiers.push('Ctrl');
        if (e.shiftKey) modifiers.push('Shift');

        let keyName = e.key;
        if (keyName === ' ') keyName = 'Space';
        else if (keyName.length === 1) keyName = keyName.toLowerCase();

        // Ignore standalone modifier presses
        if (['Alt', 'Control', 'Shift', 'CapsLock', 'Meta'].includes(keyName)) {
            return;
        }

        modifiers.push(keyName);
        const pressedStr = modifiers.join('+');

        // Look up action in hotkey map
        const activeMap = getActiveHotkeyMap();

        // Check for Pause / Continue Hotkey toggle (Alt+K by default)
        const isPauseKey = (
            pressedStr === (activeMap.toggle_pause || 'Alt+k') || 
            pressedStr.toLowerCase() === (activeMap.toggle_pause || 'Alt+k').toLowerCase() ||
            pressedStr === 'Alt+k' || 
            pressedStr === 'Alt+K'
        );
        if (isPauseKey) {
            e.preventDefault();
            window.toggleKeyboardNavigationPause();
            return;
        }

        // If keyboard navigation is currently paused by user, bypass all hotkeys!
        if (window.isKeyboardNavPaused) {
            return;
        }

        // 1. Sidebar Navigation Shortcuts (Only enabled if user is authenticated)
        const userId = document.body.getAttribute('data-user-id');
        const isUserAuthenticated = userId && userId.trim() !== "";

        if (isUserAuthenticated) {
            if (pressedStr === activeMap.nav_home) {
                e.preventDefault();
                window.location.href = '/home';
                return;
            }
            if (pressedStr === activeMap.nav_decks) {
                e.preventDefault();
                window.location.href = '/decks';
                return;
            }
            if (pressedStr === activeMap.nav_accessibility) {
                e.preventDefault();
                window.location.href = '/accessibility';
                return;
            }
            if (pressedStr === activeMap.nav_profile) {
                e.preventDefault();
                window.location.href = '/profile';
                return;
            }
        }

        // 2. Interactive Study Shortcuts & Spatial Context Handlers
        let directionKey = "";
        if (pressedStr === activeMap.focus_up || e.key === 'ArrowUp') directionKey = "ArrowUp";
        else if (pressedStr === activeMap.focus_down || e.key === 'ArrowDown') directionKey = "ArrowDown";
        else if (pressedStr === activeMap.focus_left || e.key === 'ArrowLeft') directionKey = "ArrowLeft";
        else if (pressedStr === activeMap.focus_right || e.key === 'ArrowRight') directionKey = "ArrowRight";

        // Check if focused element can consume the key (e.g. range slider step, radio switch, dropdown option)
        if (directionKey) {
            const consumed = handleContextualControl(activeEl, directionKey, e);
            if (consumed) return;

            const page = document.body.getAttribute('data-page');
            if (page === 'flashcard_deck' && (directionKey === 'ArrowRight' || directionKey === 'ArrowLeft')) {
                if (document.activeElement === document.body || document.activeElement.classList.contains('flashcard-panel')) {
                    e.preventDefault();
                    navigateFlashcardScroll(directionKey === 'ArrowRight' ? 1 : -1);
                    return;
                }
            }
            
            e.preventDefault();
            spatialNavigation(directionKey);
            return;
        }

        // Action Keys (Space / Enter) on interactive controls
        if (pressedStr === 'Space' || pressedStr === 'Enter') {
            const consumed = handleContextualControl(activeEl, pressedStr, e);
            if (consumed) return;
        }

        if (pressedStr === activeMap.action_tts) {
            e.preventDefault();
            triggerActiveTTS();
            return;
        }

        // Global Escape: Stop Autoplay if running or paused
        if (e.key === 'Escape' && isAutoplayActive) {
            e.preventDefault();
            window.stopAutoplay();
            return;
        }

        // Quiz actions
        const currentPage = document.body.getAttribute('data-page') || '';
        const isQuizPage = currentPage === 'quiz_deck' || currentPage === 'quiz' || !!document.getElementById('options-container');
        if (isQuizPage) {
            if (pressedStr === activeMap.quiz_opt1 || e.key === '1') {
                e.preventDefault();
                clickQuizOption(0);
            } else if (pressedStr === activeMap.quiz_opt2 || e.key === '2') {
                e.preventDefault();
                clickQuizOption(1);
            } else if (pressedStr === activeMap.quiz_opt3 || e.key === '3') {
                e.preventDefault();
                clickQuizOption(2);
            } else if (pressedStr === activeMap.quiz_opt4 || e.key === '4') {
                e.preventDefault();
                clickQuizOption(3);
            } else if (pressedStr === activeMap.action_enter || e.key === 'Enter') {
                e.preventDefault();
                const primaryActionBtn = document.getElementById('btn-next') || document.getElementById('btn-quiz-submit') || document.getElementById('btn-quiz-next');
                if (primaryActionBtn && !primaryActionBtn.disabled) {
                    primaryActionBtn.click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const exitBtn = document.getElementById('btn-exit-quiz');
                if (exitBtn) exitBtn.click();
            }
        }
    };

    const clickQuizOption = (optionIdx) => {
        const options = document.querySelectorAll('.btn-quiz-option, .quiz-option-button, #options-container button, .form-check-input[name="quizOption"]');
        if (options[optionIdx] && !options[optionIdx].disabled) {
            options[optionIdx].click();
            options[optionIdx].focus();
        }
    };

    document.addEventListener('keydown', handleKeyboardNavigation);

    // ── Keyboard Navigation Pause & Resume Controller ──
    window.isKeyboardNavPaused = false;

    window.toggleKeyboardNavigationPause = function(forceState) {
        if (typeof forceState === 'boolean') {
            window.isKeyboardNavPaused = forceState;
        } else {
            window.isKeyboardNavPaused = !window.isKeyboardNavPaused;
        }

        const pauseBadge = document.getElementById('keyboard-nav-pause-badge');
        const activeMap = typeof getActiveHotkeyMap === 'function' ? getActiveHotkeyMap() : { toggle_pause: 'Alt+k' };
        const pauseHotkeyLabel = activeMap.toggle_pause || 'Alt+k';

        if (pauseBadge) {
            if (window.isKeyboardNavPaused) {
                pauseBadge.classList.remove('d-none');
                const resumeBtn = pauseBadge.querySelector('#btn-resume-keyboard-nav');
                if (resumeBtn) {
                    resumeBtn.innerText = `Continue (${pauseHotkeyLabel})`;
                }
            } else {
                pauseBadge.classList.add('d-none');
            }
        }

        if (window.isKeyboardNavPaused) {
            if (window.speakScreenReader) {
                window.speakScreenReader(`Keyboard navigation paused. Press ${pauseHotkeyLabel} or click continue to resume.`);
            }
        } else {
            showResumeToast();
            if (window.speakScreenReader) {
                window.speakScreenReader("Keyboard navigation resumed.");
            }
        }
    };

    function showResumeToast() {
        const existing = document.getElementById('keyboard-nav-resume-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'keyboard-nav-resume-toast';
        toast.className = 'keyboard-nav-resume-toast';
        toast.setAttribute('role', 'status');
        toast.innerHTML = '<i class="bi bi-play-circle-fill"></i> <span>Keyboard Navigation Resumed</span>';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -20px)';
            toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 1800);
    }

    const btnResumeNav = document.getElementById('btn-resume-keyboard-nav');
    if (btnResumeNav) {
        btnResumeNav.addEventListener('click', (e) => {
            e.stopPropagation();
            window.toggleKeyboardNavigationPause(false);
        });
    }

    // ── Built-in Screen Reader Focus Speaker (Static Rule-Based Accessibility) ──
    const getAccessibleNarration = (target) => {
        if (!target) return "";

        // 1. Custom Switches & Checkboxes (Declared as 'button' for clear accessibility speech)
        if (target.tagName === 'INPUT' && (target.type === 'checkbox' || target.getAttribute('role') === 'switch' || target.classList.contains('custom-switch'))) {
            const card = target.closest('.access-card, .access-card-wrapper, .form-check, .d-flex');
            const heading = card ? (card.querySelector('h6, label, .fw-semibold')?.innerText || "") : "";
            const desc = card ? (card.querySelector('p, .text-muted, .small')?.innerText || "") : "";
            const state = target.checked ? "On" : "Off";
            let title = target.getAttribute('aria-label') || target.title || heading || target.id;
            title = title.replace(/^switch\s*/i, '').trim();
            return `${title} button, ${state}. ${desc}`.trim();
        }

        // 2. Radio buttons (Text Size, Kerning, Spacing, Contrast, Reading Level)
        if (target.tagName === 'INPUT' && target.type === 'radio') {
            const labelEl = document.querySelector(`label[for="${target.id}"]`) || target.closest('.form-check')?.querySelector('label');
            const labelText = labelEl ? labelEl.innerText : target.value;
            const groupHeader = target.closest('.mb-4, .mb-2, .form-check-group, .p-4')?.querySelector('label.fw-semibold')?.innerText || "";
            const state = target.checked ? "Selected" : "Not selected";
            return `${groupHeader ? groupHeader + ': ' : ''}${labelText}, radio option, ${state}`.trim();
        }

        // 3. Range Sliders (Speech Speed / Tempo)
        if (target.tagName === 'INPUT' && target.type === 'range') {
            const labelEl = document.querySelector(`label[for="${target.id}"]`) || target.closest('.mb-4, .access-card, .d-flex, .p-3')?.querySelector('label, h6');
            const labelText = labelEl ? labelEl.innerText : "Speech Speed";
            const badgeVal = document.getElementById('ttsRateValue')?.innerText || target.value + 'x';
            return `${labelText}: ${badgeVal}`.trim();
        }

        // 4. Select Dropdowns (Font Style, Engine, Voices)
        if (target.tagName === 'SELECT') {
            const labelEl = document.querySelector(`label[for="${target.id}"]`) || target.closest('.mb-4, .col-md-6, .access-card')?.querySelector('label, h6');
            const labelText = labelEl ? labelEl.innerText : "Dropdown";
            const selectedText = target.options[target.selectedIndex]?.text || target.value;
            return `${labelText} dropdown: ${selectedText}`.trim();
        }

        // 5. Accordions (Collapse drawer links)
        if (target.matches('a[data-bs-toggle="collapse"], button[data-bs-toggle="collapse"], .access-card')) {
            const heading = target.querySelector('h6')?.innerText || target.innerText || "";
            const desc = target.querySelector('p')?.innerText || "";
            const collapseTarget = document.querySelector(target.getAttribute('href') || target.getAttribute('data-bs-target'));
            const isExpanded = collapseTarget && collapseTarget.classList.contains('show');
            const state = isExpanded ? "Expanded" : "Collapsed";
            return `${heading}, ${state}. ${desc}`.trim();
        }

        // 6. Specific Interactive Cards (Import Card, Structure Options)
        const importEl = target.id === 'importCard' ? target : target.closest('#importCard');
        if (importEl) {
            return "Import a File button. Supports PDF, DOCX, and PPTX. Click or press Enter to choose a file.";
        }
        const descEl = target.id === 'structureCardDescriptive' ? target : target.closest('#structureCardDescriptive');
        if (descEl) {
            const isChecked = descEl.getAttribute('aria-checked') === 'true';
            return `Descriptive Type option, ${isChecked ? 'Selected' : 'Not selected'}. Formats concepts in 2-sentence paragraphs.`;
        }
        const questEl = target.id === 'structureCardQuestion' ? target : target.closest('#structureCardQuestion');
        if (questEl) {
            const isChecked = questEl.getAttribute('aria-checked') === 'true';
            return `Question Type option, ${isChecked ? 'Selected' : 'Not selected'}. Active Recall question and answer pairs.`;
        }

        // 7. Standard Buttons & Links
        let directText = target.getAttribute('aria-label') || target.title || target.innerText || target.placeholder || "";
        if (target.tagName === 'BUTTON' || target.classList.contains('btn') || target.getAttribute('role') === 'button') {
            return `Button: ${directText || "Action"}`.trim();
        }
        if (target.tagName === 'A' || target.classList.contains('nav-link')) {
            return `Link: ${directText || "Navigation"}`.trim();
        }

        return directText.trim();
    };

    document.addEventListener('focusin', (e) => {
        if (typeof window.isScreenReaderActive === "function" && !window.isScreenReaderActive()) return;
        const target = e.target;
        const textToSpeak = getAccessibleNarration(target);
        if (textToSpeak && typeof window.speakScreenReader === "function") {
            window.speakScreenReader(textToSpeak);
        }
    });

    // ── Single-Click Focus & Speak, Double-Click Execute (TalkBack / VoiceOver Accessibility Standard) ──
    let lastClickedElement = null;
    let lastClickTimestamp = 0;

    document.addEventListener('click', (e) => {
        if (typeof window.isScreenReaderActive === "function" && !window.isScreenReaderActive()) return;

        const interactive = e.target.closest('a, button, input, [role="button"], [role="switch"], [role="radio"], .btn, .custom-switch, #importCard');
        if (!interactive) {
            lastClickedElement = null;
            lastClickTimestamp = 0;
            return;
        }

        const now = Date.now();
        const isSame = (lastClickedElement === interactive) || (document.activeElement === interactive);
        const isRecent = (now - lastClickTimestamp) < 3000;

        // If this element was not previously focused/clicked or click is outside double-tap window:
        if (!isSame || !isRecent) {
            e.preventDefault();
            e.stopPropagation();
            lastClickedElement = interactive;
            lastClickTimestamp = now;
            interactive.focus();
        } else {
            // Second click on the same element: allow immediate action execution and reset state
            lastClickedElement = null;
            lastClickTimestamp = 0;
        }
    }, true);

    // ── Auditory Confirmation of Setting Toggles (Screen Reader State Changes) ──
    document.addEventListener('change', (e) => {
        const isScreenReaderEnabled = localStorage.getItem(getStorageKey('access_screen_reader')) === '1';
        if (!isScreenReaderEnabled || !window.speechSynthesis) return;

        const target = e.target;
        if (target.tagName === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio')) {
            let name = target.getAttribute('aria-label') || target.title || "";
            if (!name) {
                const card = target.closest('.access-card, .access-card-wrapper');
                if (card) {
                    const header = card.querySelector('h6');
                    if (header) name = header.innerText;
                }
            }
            if (!name) name = "Setting";

            let stateAnnounce = "";
            if (target.type === 'checkbox') {
                stateAnnounce = target.checked ? "is powered ON" : "is powered OFF";
            } else if (target.type === 'radio' && target.checked) {
                // If it's a radio option, try to get label description text
                let optionLabel = target.value;
                const siblingLabel = target.nextElementSibling;
                if (siblingLabel && (siblingLabel.tagName === 'LABEL' || siblingLabel.classList.contains('form-check-label'))) {
                    optionLabel = siblingLabel.innerText;
                }
                stateAnnounce = "is set to " + optionLabel;
            }

            if (stateAnnounce) {
                window.speechSynthesis.cancel();
                let textToSpeak = `${name} ${stateAnnounce}`;
                textToSpeak = textToSpeak
                    .replace(/\b(down|up|left|right)\s+arrow(s?)\b/gi, (match, direction, plural) => {
                        const isCapital = direction[0] === direction[0].toUpperCase();
                        const btnWord = plural ? "buttons" : "button";
                        return (isCapital ? direction : direction.toLowerCase()) + " " + btnWord;
                    })
                    .replace(/\b(arrow)(s?)\b/gi, (match, p1, p2) => {
                        const isCapital = p1[0] === 'A';
                        return (isCapital ? 'Ar-row' : 'ar-row') + p2;
                    });
                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                utterance.rate = parseFloat(localStorage.getItem(getStorageKey('ttsPlaybackRate'))) || 1.0;
                window.speechSynthesis.speak(utterance);
            }
        }
    });

});
