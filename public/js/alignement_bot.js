// Alignement alignment bot: orchestrates the steps downstream of AlignementMakeSimilars.bulkSimilars.
// split (case + plural) -> validate exacts (checkbox jsTree grouped by source) -> equivalentClass -> non-exacts.
// BotEngineClass is a core SLS module, imported by absolute path (the plugin is served under /plugins/).
import BotEngineClass from "/vocables/modules/bots/_botEngineClass.js";
import AlignementWorkflow from "./alignWorkflow.js";

var Alignement_bot = (function () {
    var self = {};
    self.myBotEngine = new BotEngineClass();

    /**
     * CSV columns for the AI-classification exports (real source/target names + ai category + reason).
     * @param {string} fromSource - Source-from name.
     * @param {string} targetSource - Target source name.
     * @returns {Array} [{ header, field }].
     */
    function aiCsvColumns(fromSource, targetSource) {
        return [
            { header: fromSource || "source", field: "srcLabel" },
            { header: targetSource || "target", field: "tgtLabel" },
            { header: "ai category", field: "category" },
            { header: "reason", field: "reason" },
        ];
    }

    /**
     * Hides every step result section except the one to keep, so the bot shows only the current step.
     * @param {string} keepDivId - The result div id of the current step (its section stays visible).
     * @returns {void}
     */
    function hideOtherStepSections(keepDivId) {
        var stepDivIds = [
            self.params.validationDivId,
            self.params.nonExactDivId,
            self.params.aiDivId,
            self.params.aiEquivDivId,
            self.params.aiSubclassDivId,
            self.params.aiRemainingDivId,
        ];
        stepDivIds.forEach(function (divId) {
            if (divId !== keepDivId) {
                $("#" + divId).parent().hide();
            }
        });
    }

    /**
     * Starts the alignment bot.
     * @param {Object} [workflow] - Optional workflow override.
     * @param {Object} _params - { bulkSimilars, fromWordsMap, source, targetSource, botDivId, validationDivId, nonExactDivId }.
     * @param {function} [callbackFn] - Optional end callback.
     * @returns {void}
     */
    self.start = function (workflow, _params, callbackFn) {
        self.title = "Alignement alignment";
        if (_params && _params.title) {
            self.title = _params.title;
        }
        var startParams = self.myBotEngine.fillStartParams(arguments);

        if (!workflow) {
            workflow = self.workflow;
        }
        self.params = {
            bulkSimilars: {},
            fromWordsMap: {},
            source: null,
            targetSource: null,
            validationDivId: "Alignement_validationDiv",
            nonExactDivId: "Alignement_nonExactDiv",
            aiDivId: "Alignement_aiDiv",
            aiEquivDivId: "Alignement_aiEquivDiv",
            aiSubclassDivId: "Alignement_aiSubclassDiv",
            aiRemainingDivId: "Alignement_aiRemainingDiv",
            exact: [],
            nonExact: [],
            aiBuckets: null,
            aiRemaining: [],
        };

        var initOptions = null;
        if (_params && _params.botDivId) {
            initOptions = { divId: _params.botDivId };
        }

        self.myBotEngine.init(Alignement_bot, workflow, initOptions, function () {
            self.myBotEngine.startParams = startParams;
            if (_params) {
                for (var key in _params) {
                    self.params[key] = _params[key];
                }
            }
            self.myBotEngine.nextStep();
        });
    };

    self.workflow = {
        startFn: {
            splitFn: {
                showValidationFn: {
                    _OR: {
                        "Generate equivalent classes": {
                            generateEquivalentClassFn: {
                                showNonExactFn: {
                                    _OR: {
                                        "AI treatment": {
                                            buildDefinitionsFn: {
                                                aiTreatmentFn: {
                                                    _OR: {
                                                        "Generate AI equivalent class": {
                                                            equivalentClassAiFn: {
                                                                _OR: {
                                                                    "Generate subclass of and inverse subclass of": {
                                                                        subclassAiFn: {
                                                                            _OR: {
                                                                                "Show remaining": {
                                                                                    remainingFn: { endFn: {} },
                                                                                },
                                                                            },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    };

    self.functionTitles = {
        startFn: "Label alignment",
        splitFn: "Split exact / non-exact (case + plural)",
        showValidationFn: "Validate exact matches (uncheck to exclude)",
        generateEquivalentClassFn: "Generate equivalent classes",
        showNonExactFn: "Show non-exact matches",
        buildDefinitionsFn: "Build class definitions (for LLM)",
        aiTreatmentFn: "AI treatment (classify non-exacts)",
        equivalentClassAiFn: "Equivalent class (Exact match AI)",
        subclassAiFn: "Subclass / inverse subclass",
        remainingFn: "Remaining (export)",
    };

    self.functions = {
        startFn: function () {
            self.myBotEngine.nextStep();
        },
        endFn: function () {
            // Alignement runs the bot in a plain div (not a jQuery UI dialog), so the engine's closeDialog()
            // throws "cannot call methods on dialog prior to initialization" — harmless, so swallow it.
            try {
                self.myBotEngine.end();
            } catch (e) {
                // no dialog to close in the embedded-div bot
            }
        },
        splitFn: function () {
            var result = AlignementWorkflow.splitExactMatches(self.params.bulkSimilars, self.params.fromWordsMap);
            self.params.exact = result.exact;
            self.params.nonExact = result.nonExact;
            self.myBotEngine.nextStep();
        },
        showValidationFn: function () {
            // Show only this step's section.
            hideOtherStepSections(self.params.validationDivId);
            var headerInfo = {
                headerDivId: "Alignement_validationHeader",
                sourceName: self.params.source,
                targetName: self.params.targetSource,
            };
            AlignementWorkflow.renderValidation(self.params.validationDivId, self.params.exact, headerInfo, function () {
                self.myBotEngine.nextStep();
            });
        },
        generateEquivalentClassFn: function () {
            var split = AlignementWorkflow.getValidatedSplit(self.params.validationDivId);
            // Unchecked exact pairs are demoted to non-exacts.
            self.params.nonExact = self.params.nonExact.concat(split.unchecked);
            AlignementWorkflow.generateEquivalentClasses(self.params.source, split.checked, function (err, insertedCount) {
                if (err) {
                    var message = err.message;
                    if (!message) {
                        message = err;
                    }
                    window.UI.message("Error inserting equivalentClass: " + message, true);
                    return;
                }
                window.UI.message(insertedCount + " equivalent classes generated in " + self.params.source, true);
                self.myBotEngine.nextStep();
            });
        },
        showNonExactFn: function () {
            hideOtherStepSections(self.params.nonExactDivId);
            AlignementWorkflow.renderNonExact(self.params.nonExactDivId, self.params.nonExact);
            self.myBotEngine.nextStep();
        },
        buildDefinitionsFn: function () {
            // Builds AlignementWorkflow.definitions (source + target class definitions) for the LLM step. No UI.
            AlignementWorkflow.buildDefinitions(self.params.source, self.params.targetSource, self.params.nonExact, function (err) {
                if (err) {
                    var message = err.message;
                    if (!message) {
                        message = err;
                    }
                    window.UI.message("Error fetching definitions: " + message, true);
                    return;
                }
                self.myBotEngine.nextStep();
            });
        },
        aiTreatmentFn: function () {
            hideOtherStepSections(self.params.aiDivId);
            alert("AI treatment may take a few minutes — please wait for it to finish.");
            // Classifies the non-exacts via the AI route (non-exacts + definitions table), using the
            // model configured in mainConfig.llm.
            AlignementWorkflow.runAiTreatment(self.params.source, self.params.targetSource, self.params.nonExact, AlignementWorkflow.definitions, self.params.aiDivId, function (err) {
                if (err) {
                    var message = err.message;
                    if (!message) {
                        message = err;
                    }
                    window.UI.message("Error during AI treatment: " + message, true);
                    return;
                }
                self.myBotEngine.nextStep();
            });
        },
        equivalentClassAiFn: function () {
            hideOtherStepSections(self.params.aiEquivDivId);
            // Recover URIs for the LLM classifications, split by category, and start the post-AI flow.
            var enriched = AlignementWorkflow.enrichWithUris(AlignementWorkflow.aiTreatment.classifications, self.params.nonExact);
            self.params.aiBuckets = AlignementWorkflow.splitByAiCategory(enriched);
            self.params.aiRemaining = [];
            if (self.params.aiBuckets.exactAi.length === 0) {
                alert("No Exact match AI — moving to the next step.");
                self.myBotEngine.nextStep();
                return;
            }
            var columns = aiCsvColumns(self.params.source, self.params.targetSource);

            // "generate AI equivalent class" creates the triples (does NOT advance); "Exporter" exports;
            // "generate subclass of and inverse subclass of" advances to the subclass step (no save required).
            var onSave = function (treeDivId) {
                var split = AlignementWorkflow.getAiCheckSplit(treeDivId);
                AlignementWorkflow.generateEquivalentClasses(self.params.source, split.checked, function (err, insertedCount) {
                    if (err) {
                        window.UI.message("Error inserting equivalentClass: " + (err.message || err), true);
                        return;
                    }
                    window.UI.message(insertedCount + " equivalent classes generated in " + self.params.source, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignementWorkflow.getAiCheckSplit(treeDivId);
                AlignementWorkflow.exportPairsToCsv(split.checked, columns, "equivalent_class_AI.csv");
            };
            AlignementWorkflow.renderAiValidationStep(
                self.params.aiEquivDivId,
                self.params.aiBuckets.exactAi,
                {
                    title: "Exact match AI → equivalentClass",
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: "generate AI equivalent class",
                },
                { onSave: onSave, onExport: onExport },
            );
            // Reveal the advance bubble ("Generate subclass of and inverse subclass of") — no save required.
            self.myBotEngine.nextStep();
        },
        subclassAiFn: function () {
            hideOtherStepSections(self.params.aiSubclassDivId);
            // Carry the unchecked Exact match AI (from the equivalent step) to the remaining bucket.
            if (self.params.aiBuckets.exactAi.length > 0) {
                var equivSplit = AlignementWorkflow.getAiCheckSplit(self.params.aiEquivDivId + "_tree");
                self.params.aiRemaining = self.params.aiRemaining.concat(equivSplit.unchecked);
            }
            var subPairs = self.params.aiBuckets.subclassOf.concat(self.params.aiBuckets.subclassOfInverse);
            if (subPairs.length === 0) {
                alert("No SubclassOf / SubclassOf inverse — moving to the next step.");
                self.myBotEngine.nextStep();
                return;
            }
            var columns = aiCsvColumns(self.params.source, self.params.targetSource);

            var onSave = function (treeDivId) {
                var split = AlignementWorkflow.getAiCheckSplit(treeDivId);
                AlignementWorkflow.generateSubClasses(self.params.source, split.checked, function (err, insertedCount) {
                    if (err) {
                        window.UI.message("Error inserting subClassOf: " + (err.message || err), true);
                        return;
                    }
                    window.UI.message(insertedCount + " subClassOf triples generated in " + self.params.source, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignementWorkflow.getAiCheckSplit(treeDivId);
                AlignementWorkflow.exportPairsToCsv(split.checked, columns, "subclass_AI.csv");
            };
            AlignementWorkflow.renderAiValidationStep(
                self.params.aiSubclassDivId,
                subPairs,
                {
                    title: "SubclassOf / SubclassOf inverse → subClassOf",
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: "generate subclass of and inverse subclass of",
                },
                { onSave: onSave, onExport: onExport },
            );
            // Reveal the advance bubble ("Show remaining").
            self.myBotEngine.nextStep();
        },
        remainingFn: function () {
            hideOtherStepSections(self.params.aiRemainingDivId);
            var buckets = self.params.aiBuckets;
            // Carry the unchecked SubclassOf / inverse (from the subclass step) to the remaining bucket.
            if (buckets.subclassOf.length + buckets.subclassOfInverse.length > 0) {
                var subSplit = AlignementWorkflow.getAiCheckSplit(self.params.aiSubclassDivId + "_tree");
                self.params.aiRemaining = self.params.aiRemaining.concat(subSplit.unchecked);
            }
            var remaining = self.params.aiRemaining.concat(buckets.notMatch, buckets.unknown, buckets.other);
            if (remaining.length === 0) {
                alert("No remaining rows to export — end of workflow.");
                self.myBotEngine.nextStep();
                return;
            }
            var columns = aiCsvColumns(self.params.source, self.params.targetSource);
            var onExport = function () {
                AlignementWorkflow.exportPairsToCsv(remaining, columns, "remaining_AI.csv");
                self.myBotEngine.nextStep();
            };
            AlignementWorkflow.renderRemaining(self.params.aiRemainingDivId, remaining, self.params.source, self.params.targetSource, onExport);
        },
    };

    return self;
})();

export default Alignement_bot;
window.Alignement_bot = Alignement_bot;
