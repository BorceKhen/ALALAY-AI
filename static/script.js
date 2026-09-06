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
        focus_right: 'ArrowRight'
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
        // Click the card → open the hidden file picker
        importCard.addEventListener("click", () => fileInput.click());

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
                console.error("[UHTEM Upload Error]", err);
            })
            .finally(() => {
                // Reset file input so the same file can be re-selected
                fileInput.value = "";
            });
        });
    }

    // ── Generate Flashcard button ───────────────────────────
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

        generateBtn.addEventListener("click", () => {
            if (!lastExtractionData || !lastExtractionData.extracted_text || !lastExtractionData.extracted_text.trim()) {
                if (typeof showToast === "function") {
                    showToast("Cannot generate flashcards: The uploaded file contains no text.", "error");
                }
                return;
            }

            // Trigger loading modal only when valid content exists
            if (typeof window.showQuizPopLoading === "function") {
                window.showQuizPopLoading("Generating Flashcards & Quiz...", "Extracting key concepts & generating 20 questions...");
            }

            // Loading state
            generateBtn.disabled = true;
            generateBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span> Generating...`;
            if (generateStatus) generateStatus.style.display = "none";

            fetch("/generate-flashcard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(lastExtractionData)
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Success state
                    generateBtn.innerHTML = `<span style="font-size:1.3rem;">✔</span> Deck Created!`;
                    generateBtn.style.background = "#28a745";

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

                if (generateStatus) {
                    generateStatus.textContent = `⚠ Failed: ${err.message}`;
                    generateStatus.style.color = "#dc3545";
                    generateStatus.style.display = "block";
                }
                if (typeof showToast === "function") {
                    showToast("Failed to connect to generation server.", "error");
                }
                console.error("[Flashcard Generation Error]", err);
            });
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

        sliderTtsRate.addEventListener('input', (e) => {
            const rate = e.target.value;
            localStorage.setItem(getStorageKey('ttsPlaybackRate'), rate);
            document.body.setAttribute('data-tts-rate', rate);
            if (ttsRateValue) {
                ttsRateValue.textContent = `${parseFloat(rate).toFixed(2)}x`;
            }
        });

        sliderTtsRate.addEventListener('change', () => {
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
            { value: "2mjoFhAXQxxi6hlzpupi", text: "Miguel (Male - Dynamic)" },
            { value: "jz3ZhMqlkCVI6zGzELGw", text: "Maya (Female - Expressive)" },
            { value: "wewocdDkjSLm9ZwjO7TD", text: "Belle (Female - Smooth)" },
            { value: "U9VgC8Xinl7nnNsyDd3J", text: "Rachel (Female - Clear)" }
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
    let autoplayTriggers = [];
    let autoplayIndex = -1;
    let autoplayTimeoutId = null;

    // Helper: Wrap text node words in span elements
    function wrapTextInWords(element) {
        if (!element || element.getAttribute('data-original-html')) return;
        
        element.setAttribute('data-original-html', element.innerHTML);
        const text = element.textContent;
        const words = text.split(/(\s+)/);
        let charCount = 0;

        const wrappedHTML = words.map(word => {
            const wordLength = word.length;
            if (word.trim() === '') {
                charCount += wordLength;
                return word;
            }
            const start = charCount;
            const end = charCount + wordLength;
            charCount += wordLength;
            return `<span class="tts-word" data-start="${start}" data-end="${end}">${word}</span>`;
        }).join('');

        element.innerHTML = wrappedHTML;
    }

    // Helper: Restore text to original structure
    function restoreOriginalText(element) {
        if (!element) return;
        const originalHTML = element.getAttribute('data-original-html');
        if (originalHTML) {
            element.innerHTML = originalHTML;
            element.removeAttribute('data-original-html');
        }
    }

    // Helper: Animation loop tracking currentTime and highlighting matching word
    function startHighlightLoop(audio, element, spokenText) {
        if (!audio || !element) return;
        const words = element.querySelectorAll('.tts-word');
        const totalChars = element.textContent.length;

        // Calculate ratio of element text length to total spoken text length
        const elText = element.textContent.trim().toLowerCase();
        const fullText = (spokenText || "").trim().toLowerCase();
        let ratio = 1.0;
        const cleanEl = elText.replace(/[^a-z0-9]/g, "");
        const cleanFull = fullText.replace(/[^a-z0-9]/g, "");
        if (cleanFull.length > 0 && cleanFull.startsWith(cleanEl) && cleanFull.length > cleanEl.length) {
            ratio = cleanEl.length / cleanFull.length;
        }

        function updateHighlight() {
            if (audio.paused || audio.ended) {
                cancelAnimationFrame(highlightAnimationFrameId);
                return;
            }

            const duration = audio.duration;
            if (duration) {
                const currentTime = audio.currentTime;
                // standard head & tail silence offsets for gTTS
                const startOffset = 0.15;
                const endOffset = 0.25;
                const speechDuration = Math.max(0.1, duration - startOffset - endOffset);
                const speechTime = Math.max(0, currentTime - startOffset);
                const activeChar = Math.min(totalChars, (speechTime / (speechDuration * ratio)) * totalChars);

                words.forEach(word => {
                    const start = parseInt(word.getAttribute('data-start'));
                    const end = parseInt(word.getAttribute('data-end'));

                    if (activeChar >= start && activeChar < end) {
                        word.classList.add('tts-highlight');
                    } else {
                        word.classList.remove('tts-highlight');
                    }
                });
            }
            highlightAnimationFrameId = requestAnimationFrame(updateHighlight);
        }

        highlightAnimationFrameId = requestAnimationFrame(updateHighlight);
    }

    // Autoplay TTS functionality
    function triggerNextAutoplay() {
        if (!isAutoplayActive) return;

        autoplayIndex++;
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

        window.speakText(text, nextTrigger);
    }

    window.startAutoplay = function() {
        isAutoplayActive = true;
        autoplayIndex = -1;
        autoplayTriggers = Array.from(document.querySelectorAll('.tts-trigger'));
        
        updateAutoplayUI(true);
        triggerNextAutoplay();
    };

    window.stopAutoplay = function() {
        isAutoplayActive = false;
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

        updateAutoplayUI(false);
    };

    window.toggleAutoplay = function() {
        if (isAutoplayActive) {
            window.stopAutoplay();
        } else {
            window.startAutoplay();
        }
    };

    function updateAutoplayUI(isPlaying) {
        const buttons = document.querySelectorAll('.btn-autoplay-tts, #btn-autoplay-tts-floating');
        buttons.forEach(btn => {
            const icon = btn.querySelector('i');
            const textSpan = btn.querySelector('.autoplay-text-span');

            if (isPlaying) {
                btn.classList.remove('btn-outline-primary');
                btn.classList.add('btn-danger');
                if (icon) icon.className = "bi bi-stop-circle-fill";
                if (textSpan) textSpan.textContent = "Stop Auto Play";
            } else {
                btn.classList.remove('btn-danger');
                btn.classList.add('btn-outline-primary');
                if (icon) icon.className = "bi bi-play-circle-fill";
                if (textSpan) textSpan.textContent = "Auto Play TTS";
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

        // If autoplay is active and the user manually clicked a different TTS trigger, stop autoplay
        if (isAutoplayActive && btnElement && btnElement !== autoplayTriggers[autoplayIndex]) {
            window.stopAutoplay();
        }

        // Toggle behavior: If the active audio is playing and we click the same button, pause it
        if (activeAudio && activeTtsButton === btnElement && !activeAudio.paused) {
            activeAudio.pause();
            resetButtonIcon(btnElement);
            if (activeTextElement) {
                restoreOriginalText(activeTextElement);
            }
            activeAudio = null;
            activeTtsButton = null;
            activeTextElement = null;
            
            if (window.TelemetryTracker && window.TelemetryTracker.trackTTSPause) {
                window.TelemetryTracker.trackTTSPause();
            }
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
            const panel = btnElement.closest(".flashcard-panel-top, .flashcard-panel-bottom");
            if (panel) {
                targetTextEl = panel.querySelector(".flashcard-text-title, .flashcard-text-body");
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
        audio.addEventListener("play", () => {
            audio.playbackRate = bodyTtsRate;
            setButtonIconPlaying(btnElement);
            if (targetTextEl) {
                startHighlightLoop(audio, targetTextEl, text);
            }
            if (window.TelemetryTracker && window.TelemetryTracker.trackTTSPlay) {
                window.TelemetryTracker.trackTTSPlay();
            }
        });

        audio.addEventListener("pause", () => {
            resetButtonIcon(btnElement);
            if (targetTextEl) {
                restoreOriginalText(targetTextEl);
            }
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
            if (isAutoplayActive) {
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
            if (isAutoplayActive) {
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
            if (isAutoplayActive) {
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

    // ── Agency Controller Event Bindings ──
    const agencySnackbar = document.getElementById("agency-snackbar");
    const btnAgencyAccept = document.getElementById("btn-agency-accept");
    const btnAgencyDecline = document.getElementById("btn-agency-decline");
    const btnAgencyClose = document.getElementById("btn-agency-close");
    const chkAgencyDontShow = document.getElementById("chk-agency-dont-show");

    let recSignature = "";
    if (btnAgencyAccept) {
        recSignature = btnAgencyAccept.getAttribute("data-pending-settings") || "";
    }

    // Hide snackbar immediately if ignored or silenced for this session
    if (agencySnackbar) {
        const isSilenced = sessionStorage.getItem("silence_ai_recommendations") === "true";
        const ignoredRec = sessionStorage.getItem("ignored_ai_recommendation");
        if (isSilenced || (recSignature && ignoredRec === recSignature)) {
            agencySnackbar.style.display = "none";
        }
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
            btnAgencyClose.addEventListener("click", dismissSnackbar);
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

        cards.forEach((card, idx) => {
            const rect = card.getBoundingClientRect();
            const dist = Math.abs(rect.top - 120); // offset header
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
            const cards = document.querySelectorAll('.flashcard-item');
            if (cards.length === 0) return;

            let minDistance = Infinity;
            let closestCard = null;

            cards.forEach(card => {
                const rect = card.getBoundingClientRect();
                const dist = Math.abs(rect.top - 120);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestCard = card;
                }
            });

            if (closestCard) {
                const trigger = closestCard.querySelector('.tts-trigger');
                if (trigger) trigger.click();
            }
        } else if (page === 'quiz_deck') {
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

        // 6. Standard Buttons & Links
        let directText = target.getAttribute('aria-label') || target.title || target.innerText || target.placeholder || "";
        if (target.tagName === 'BUTTON' || target.classList.contains('btn')) {
            return `Button: ${directText || "Action"}`.trim();
        }
        if (target.tagName === 'A' || target.classList.contains('nav-link')) {
            return `Link: ${directText || "Navigation"}`.trim();
        }

        return directText.trim();
    };

    document.addEventListener('focusin', (e) => {
        const isScreenReaderEnabled = localStorage.getItem(getStorageKey('access_screen_reader')) === '1';
        if (isScreenReaderEnabled && window.speechSynthesis) {
            const target = e.target;
            let textToSpeak = getAccessibleNarration(target);
            
            // Clean up text & expand abbreviations (TTS -> Text-to-Speech)
            textToSpeak = textToSpeak
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
            
            if (textToSpeak) {
                window.speechSynthesis.cancel();
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();

                const utterance = new SpeechSynthesisUtterance(textToSpeak);
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

                setTimeout(() => {
                    window.speechSynthesis.speak(utterance);
                }, 10);
            }
        }
    });

    // ── Single-Click Focus & Speak, Double-Click Execute ──
    let lastClickedElement = null;

    document.addEventListener('focusout', () => {
        lastClickedElement = null;
    });

    document.addEventListener('click', (e) => {
        const isScreenReaderEnabled = localStorage.getItem(getStorageKey('access_screen_reader')) === '1';
        if (!isScreenReaderEnabled) return;

        const interactive = e.target.closest('a, button, input, [role="button"], [role="switch"], .btn, .custom-switch');
        if (!interactive) return;

        // If this element was not the last clicked one, prevent default and focus it
        if (lastClickedElement !== interactive) {
            e.preventDefault();
            e.stopPropagation();
            lastClickedElement = interactive;
            interactive.focus();
        } else {
            // Second click: Reset state and let the click action proceed normally
            lastClickedElement = null;
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
