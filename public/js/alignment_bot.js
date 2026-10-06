// Alignment bot: orchestrates the steps downstream of AlignmentMakeSimilars.bulkSimilars.
// split (case + plural) -> validate exacts (checkbox jsTree grouped by source) -> equivalentClass -> non-exacts.
// BotEngineClass is a core SLS module, imported by absolute path (the plugin is served under /plugins/).
import BotEngineClass from "/vocables/modules/bots/_botEngineClass.js";
import AlignmentWorkflow from "./alignWorkflow.js";


var Alignment_bot = (function () {
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
            {header: fromSource || "source", field: "srcLabel"},
            {header: targetSource || "target", field: "tgtLabel"},
            {header: "ai category", field: "category"},
            {header: "reason", field: "reason"},
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
        self.title = "Alignment";
        if (_params && _params.title) {
            self.title = _params.title;
        }
        var startParams = self.myBotEngine.fillStartParams(arguments);

        var isSkosRun = false;
        if (_params) {
            isSkosRun = AlignmentWorkflow.isSkosTarget(_params.targetSource);
        }
        if (!workflow) {
            workflow = self.workflow;
            if (isSkosRun) {
                workflow = self.skosWorkflow;
            }
        }
        // Step titles follow the workflow labels: the AI steps write skos matches instead of OWL triples.
        if (isSkosRun) {
            self.functionTitles.equivalentClassAiFn = "Exact match AI (skos:exactMatch)";
            self.functionTitles.subclassAiFn = "Subclass / inverse subclass (skos:narrower)";
        } else {
            self.functionTitles.equivalentClassAiFn = "Equivalent class (Exact match AI)";
            self.functionTitles.subclassAiFn = "Subclass / inverse subclass";
        }
        self.params = {
            bulkSimilars: {},
            fromWordsMap: {},
            source: null,
            targetSource: null,
            validationDivId: "Alignment_validationDiv",
            generateEquivBtnDivId: "Alignment_generateEquivBtnDiv",
            nonExactDivId: "Alignment_nonExactDiv",
            aiDivId: "Alignment_aiDiv",
            aiEquivDivId: "Alignment_aiEquivDiv",
            aiSubclassDivId: "Alignment_aiSubclassDiv",
            aiRemainingDivId: "Alignment_aiRemainingDiv",
            exact: [],
            nonExact: [],
            aiBuckets: null,
            aiRemaining: [],
        };

        var initOptions = null;
        if (_params && _params.botDivId) {
            initOptions = {divId: _params.botDivId};
        }

        self.myBotEngine.init(Alignment_bot, workflow, initOptions, function () {
            self.myBotEngine.startParams = startParams;
            if (_params) {
                for (var key in _params) {
                    self.params[key] = _params[key];
                }
            }
            // Route the generated triples to the alignment source matching the chosen target.
            AlignmentWorkflow.setAlignmentSourceForTarget(self.params.targetSource);
            self.myBotEngine.nextStep();
        });
    };

    /**
     * Builds the bot workflow. Its two AI steps are named after the triples they write, which differ
     * between the OWL alignment (equivalentClass / subClassOf) and the SKOS one (exact match / narrower),
     * hence the two labels rather than two copies of the workflow.
     * @param {string} exactStepLabel - Bubble label of the step writing the exact alignment triples.
     * @param {string} closeStepLabel - Bubble label of the step writing the subclass / narrower triples.
     * @returns {Object} The workflow object.
     */
    self.buildWorkflow = function (exactStepLabel, closeStepLabel) {
        // labels and superclass are no longer bot steps: they are buttons of the validation steps
        // (AlignmentWorkflow.renderLabelAndSuperClassButtons).
        // "Reindex graph" must stay under _OR: a bare string key is resolved as a function name by the
        // engine, which raised "function not defined".
        var closeStepAlternatives = {};
        closeStepAlternatives[closeStepLabel] = {
            subclassAiFn: {
                _OR: {
                    "Reindex graph": {
                        reindexGraphFn: {
                            _OR: {
                                "Show remaining": {remainingFn: {endFn: {}}},
                                "End": {endFn: {}}
                            }
                        }
                    },
                    "Show remaining": {remainingFn: {endFn: {}}},
                    "End": {endFn: {}}
                }
            }
        };
        var exactStepAlternatives = {};
        exactStepAlternatives[exactStepLabel] = {
            equivalentClassAiFn: {_OR: closeStepAlternatives}
        };
        return {
            startFn: {
                splitFn: {
                    showValidationFn: {
                        _OR: {
                            "view non exact match": {
                                viewNonExactFn: {
                                    showNonExactFn: {
                                        _OR: {
                                            "AI treatment": {
                                                buildDefinitionsFn: {
                                                    aiTreatmentFn: {_OR: exactStepAlternatives},
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
    };

    self.workflow = self.buildWorkflow("Generate AI equivalent class", "Generate subclass of and inverse subclass of");
    self.skosWorkflow = self.buildWorkflow("generate skos exact match", "generate skos:narrower");

    self.functionTitles = {
        startFn: "Label alignment",
        splitFn: "Split exact / non-exact (case + plural)",
        showValidationFn: "Validate exact matches (uncheck to exclude)",
        viewNonExactFn: "View non-exact matches",
        showNonExactFn: "Show non-exact matches",
        buildDefinitionsFn: "Build class definitions (for LLM)",
        aiTreatmentFn: "AI treatment (classify non-exacts)",
        equivalentClassAiFn: "Equivalent class (Exact match AI)",
        subclassAiFn: "Subclass / inverse subclass",
        remainingFn: "Remaining (export)",
        reindexGraphFn:"Reindex target Graph",

    };

    self.functions = {
        startFn: function () {
            self.myBotEngine.nextStep();
        },
        endFn: function () {
            // Alignment runs the bot in a plain div (not a jQuery UI dialog), so the engine's closeDialog()
            // throws "cannot call methods on dialog prior to initialization" — harmless, so swallow it.
            try {
                self.myBotEngine.end();
            } catch (e) {
                // no dialog to close in the embedded-div bot
            }
        },
        splitFn: function () {
            var result = AlignmentWorkflow.splitExactMatches(self.params.bulkSimilars, self.params.fromWordsMap);
            self.params.exact = result.exact;
            self.params.nonExact = result.nonExact;
            self.myBotEngine.nextStep();
        },
        showValidationFn: function () {
            // Show only this step's section.
            hideOtherStepSections(self.params.validationDivId);
            var headerInfo = {
                headerDivId: "Alignment_validationHeader",
                sourceName: self.params.source,
                targetName: self.params.targetSource,
            };
            AlignmentWorkflow.renderValidation(self.params.validationDivId, self.params.exact, headerInfo, function () {
                self.myBotEngine.nextStep();
            });
            // Standalone buttons on the checked exact matches (equivalentClass / labels / superclass),
            // decoupled from advancing the bot. Belong to the validation step only.
            AlignmentWorkflow.renderValidationStepButtons(self.params.generateEquivBtnDivId, self.params.targetSource, self.params.source);
        },
        viewNonExactFn: function () {
            // Only navigation: demote the unchecked exact pairs to non-exacts and move to the non-exact step.
            // equivalentClass creation is now done by the standalone "generate equivalent class" button.
            var split = AlignmentWorkflow.getValidatedSplit(self.params.validationDivId);
            self.params.nonExact = self.params.nonExact.concat(split.unchecked);
            $("#" + self.params.generateEquivBtnDivId).hide();
            self.myBotEngine.nextStep();
        },
        showNonExactFn: function () {
            hideOtherStepSections(self.params.nonExactDivId);
            AlignmentWorkflow.renderNonExact(self.params.nonExactDivId, self.params.nonExact);
            self.myBotEngine.nextStep();
        },
        buildDefinitionsFn: function () {
            // Builds AlignmentWorkflow.definitions (source + target class definitions) for the LLM step. No UI.
            AlignmentWorkflow.buildDefinitions(self.params.source, self.params.targetSource, self.params.nonExact, function (err) {
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
            AlignmentWorkflow.runAiTreatment(self.params.source, self.params.targetSource, self.params.nonExact, AlignmentWorkflow.definitions, self.params.aiDivId, function (err) {
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
            var enriched = AlignmentWorkflow.enrichWithUris(AlignmentWorkflow.aiTreatment.classifications, self.params.nonExact);
            self.params.aiBuckets = AlignmentWorkflow.splitByAiCategory(enriched);
            self.params.aiRemaining = [];
            if (self.params.aiBuckets.exactAi.length === 0) {
                alert("No Exact match AI — moving to the next step.");
                self.myBotEngine.nextStep();
                return;
            }

            var stepTitle = "Exact match AI → equivalentClass";
            var saveLabel = "generate AI equivalent class";
            var exportFileName = "equivalent_class_AI.csv";
            var createdLabel = "equivalent classes";
            var predicateUri = AlignmentWorkflow.owlEquivalentClassUri;
            if (AlignmentWorkflow.isSkosTarget(self.params.targetSource)) {
                stepTitle = "Exact match AI → skos:exactMatch";
                saveLabel = "generate skos exact match";
                exportFileName = "skos_exact_match.csv";
                createdLabel = "skos:exactMatch";
                predicateUri = AlignmentWorkflow.skosExactMatchUri;
            }
            var savePairs = function (pairs, callback) {
                AlignmentWorkflow.generateAlignmentTriplesIdempotent(pairs, predicateUri, callback);
            };

            // The save button creates the triples (does NOT advance); "Exporter" exports; the next bubble
            // advances to the narrower / subclass step (no save required).
            var onSave = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                savePairs(split.checked, function (err, result) {
                    if (err) {
                        window.UI.message("Error inserting " + createdLabel + ": " + (err.message || err), true);
                        return;
                    }
                    var message = result.created + " " + createdLabel + " created";
                    if (result.skipped > 0) {
                        message += " (" + result.skipped + " already created, skipped)";
                    }
                    window.UI.message(message + " in " + AlignmentWorkflow.ALIGNMENT_SOURCE, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                var getExactTriple = function (pair) {
                    return AlignmentWorkflow.getAlignmentTriple(pair, predicateUri);
                };
                AlignmentWorkflow.exportTriplesToCsv(split.checked, getExactTriple, exportFileName);
            };
            AlignmentWorkflow.renderAiValidationStep(
                self.params.aiEquivDivId,
                self.params.aiBuckets.exactAi,
                {
                    title: stepTitle,
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: saveLabel,
                },
                {onSave: onSave, onExport: onExport},
            );
            // Reveal the advance bubble ("Generate subclass of and inverse subclass of") — no save required.
            self.myBotEngine.nextStep();
        },
        subclassAiFn: function () {
            hideOtherStepSections(self.params.aiSubclassDivId);
            // Carry the unchecked Exact match AI (from the equivalent step) to the remaining bucket.
            if (self.params.aiBuckets.exactAi.length > 0) {
                var equivSplit = AlignmentWorkflow.getAiCheckSplit(self.params.aiEquivDivId + "_tree");
                self.params.aiRemaining = self.params.aiRemaining.concat(equivSplit.unchecked);
            }
            var subPairs = self.params.aiBuckets.subclassOf.concat(self.params.aiBuckets.subclassOfInverse);
            if (subPairs.length === 0) {
                alert("No SubclassOf / SubclassOf inverse — moving to the next step.");
                self.myBotEngine.nextStep();
                return;
            }

            var stepTitle = "SubclassOf / SubclassOf inverse → subClassOf";
            var saveLabel = "generate subclass of and inverse subclass of";
            var exportFileName = "subclass_AI.csv";
            var createdLabel = "subClassOf triples";
            var savePairs = AlignmentWorkflow.generateSubClassesIdempotent;
            if (AlignmentWorkflow.isSkosTarget(self.params.targetSource)) {
                stepTitle = "SubclassOf / SubclassOf inverse → skos:narrower";
                saveLabel = "generate skos:narrower";
                exportFileName = "skos_narrower.csv";
                createdLabel = "skos:narrower / skos:broader";
                savePairs = AlignmentWorkflow.generateSkosHierarchyTriplesIdempotent;
            }

            var onSave = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                savePairs(split.checked, function (err, result) {
                    if (err) {
                        window.UI.message("Error inserting " + createdLabel + ": " + (err.message || err), true);
                        return;
                    }
                    var message = result.created + " " + createdLabel + " created";
                    if (result.skipped > 0) {
                        message += " (" + result.skipped + " already created, skipped)";
                    }
                    window.UI.message(message + " in " + AlignmentWorkflow.ALIGNMENT_SOURCE, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                AlignmentWorkflow.exportTriplesToCsv(split.checked, AlignmentWorkflow.getHierarchyTriple, exportFileName);
            };
            AlignmentWorkflow.renderAiValidationStep(
                self.params.aiSubclassDivId,
                subPairs,
                {
                    title: stepTitle,
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: saveLabel,
                },
                {onSave: onSave, onExport: onExport},
            );
            // Reveal the advance bubble ("Show remaining").
            self.myBotEngine.nextStep();
        },
        remainingFn: function () {
            hideOtherStepSections(self.params.aiRemainingDivId);
            var buckets = self.params.aiBuckets;
            // Carry the unchecked SubclassOf / inverse (from the subclass step) to the remaining bucket.
            if (buckets.subclassOf.length + buckets.subclassOfInverse.length > 0) {
                var subSplit = AlignmentWorkflow.getAiCheckSplit(self.params.aiSubclassDivId + "_tree");
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
                AlignmentWorkflow.exportPairsToCsv(remaining, columns, "remaining_AI.csv");
                self.myBotEngine.nextStep();
            };
            AlignmentWorkflow.renderRemaining(self.params.aiRemainingDivId, remaining, self.params.source, self.params.targetSource, onExport);
        },

        // createLabelsFn / createSuperClassFn removed: both wrote into the reference ontology graph
        // (Config.sources[targetSource].graphUri) instead of the alignment source, and swept the whole
        // graph regardless of the checked rows. They are now the "generate label" / "create superclass"
        // buttons of the validation step, in AlignmentWorkflow.renderValidationStepButtons.

        // Reindexes the source that actually received the generated triples (ALIGNMENT_UNSPSC /
        // ALIGNMENT_ECLASS), not the reference ontology: without it the new equivalentClass,
        // subClassOf and label triples stay invisible to the ElasticSearch-backed searches.
        reindexGraphFn: function () {
            var alignmentSource = AlignmentWorkflow.ALIGNMENT_SOURCE;
            if (!alignmentSource) {
                self.myBotEngine.error("no alignment source selected for the chosen target source: nothing to reindex");
                return self.myBotEngine.end();
            }
            self.myBotEngine.message("indexing " + alignmentSource + "...");
            SearchUtil.generateElasticIndex(
                alignmentSource,
                {
                    indexProperties: 1,
                    indexNamedIndividuals: 1,
                },
                function (err, _result) {
                    if (err) {
                        self.myBotEngine.error(err.responseText || err)
                        return self.myBotEngine.end()
                    }
                    self.myBotEngine.message(alignmentSource + " indexed")
                    self.myBotEngine.nextStep();
                },
            );

        },

    };

    return self;
})();

export default Alignment_bot;
window.Alignment_bot = Alignment_bot;
