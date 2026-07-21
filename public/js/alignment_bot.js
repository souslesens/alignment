// Alignment bot: orchestrates the steps downstream of AlignmentMakeSimilars.bulkSimilars.
// split (case + plural) -> validate exacts (checkbox jsTree grouped by source) -> equivalentClass -> non-exacts.
// BotEngineClass is a core SLS module, imported by absolute path (the plugin is served under /plugins/).
import BotEngineClass from "/vocables/modules/bots/_botEngineClass.js";
import AlignmentWorkflow from "./alignWorkflow.js";
import AlignmentUtil from "./alignmentUtil.js";


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

        if (!workflow) {
            workflow = self.workflow;
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

    self.workflow = {
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
                                                aiTreatmentFn: {
                                                    _OR: {
                                                        "Generate AI equivalent class": {
                                                            equivalentClassAiFn: {
                                                                _OR: {
                                                                    "Generate subclass of and inverse subclass of": {
                                                                        subclassAiFn: {
                                                                                    createLabelsFn: {
                                                                                            createSuperClassFn: {
                                                                                                "Reindex graph": {
                                                                                                    reindexGraphFn: {
                                                                                                        _OR: {
                                                                                                            "Show remaining": {
                                                                                                                remainingFn: {endFn: {}},
                                                                                                            },
                                                                                                            "End": {endFn: {}}
                                                                                                        }
                                                                                                    }
                                                                                                }


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
        viewNonExactFn: "View non-exact matches",
        showNonExactFn: "Show non-exact matches",
        buildDefinitionsFn: "Build class definitions (for LLM)",
        aiTreatmentFn: "AI treatment (classify non-exacts)",
        equivalentClassAiFn: "Equivalent class (Exact match AI)",
        subclassAiFn: "Subclass / inverse subclass",
        remainingFn: "Remaining (export)",
        createLabelsFn: " Create Labels",
        createSuperClassFn: "Create SuperClass",
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
            // Standalone button: generate equivalentClass for the checked exact matches (idempotent),
            // decoupled from advancing the bot. Belongs to the validation step only.
            AlignmentWorkflow.renderGenerateEquivButton(self.params.generateEquivBtnDivId);
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
            var columns = aiCsvColumns(self.params.source, self.params.targetSource);

            // "generate AI equivalent class" creates the triples (does NOT advance); "Exporter" exports;
            // "generate subclass of and inverse subclass of" advances to the subclass step (no save required).
            var onSave = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                AlignmentWorkflow.generateEquivalentClassesIdempotent(split.checked, function (err, result) {
                    if (err) {
                        window.UI.message("Error inserting equivalentClass: " + (err.message || err), true);
                        return;
                    }
                    var message = result.created + " equivalent classes created";
                    if (result.skipped > 0) {
                        message += " (" + result.skipped + " already created, skipped)";
                    }
                    window.UI.message(message + " in " + AlignmentWorkflow.ALIGNMENT_SOURCE, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                AlignmentWorkflow.exportPairsToCsv(split.checked, columns, "equivalent_class_AI.csv");
            };
            AlignmentWorkflow.renderAiValidationStep(
                self.params.aiEquivDivId,
                self.params.aiBuckets.exactAi,
                {
                    title: "Exact match AI → equivalentClass",
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: "generate AI equivalent class",
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
            var columns = aiCsvColumns(self.params.source, self.params.targetSource);

            var onSave = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                AlignmentWorkflow.generateSubClassesIdempotent(split.checked, function (err, result) {
                    if (err) {
                        window.UI.message("Error inserting subClassOf: " + (err.message || err), true);
                        return;
                    }
                    var message = result.created + " subClassOf triples created";
                    if (result.skipped > 0) {
                        message += " (" + result.skipped + " already created, skipped)";
                    }
                    window.UI.message(message + " in " + AlignmentWorkflow.ALIGNMENT_SOURCE, true);
                });
            };
            var onExport = function (treeDivId) {
                var split = AlignmentWorkflow.getAiCheckSplit(treeDivId);
                AlignmentWorkflow.exportPairsToCsv(split.checked, columns, "subclass_AI.csv");
            };
            AlignmentWorkflow.renderAiValidationStep(
                self.params.aiSubclassDivId,
                subPairs,
                {
                    title: "SubclassOf / SubclassOf inverse → subClassOf",
                    sourceName: self.params.source,
                    targetName: self.params.targetSource,
                    saveLabel: "generate subclass of and inverse subclass of",
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

        createLabelsFn: function () {
            if (confirm("confirm creation of labels from " + self.params.source)) {

                var targetGraph = Config.sources[self.params.targetSource].graphUri
                var query = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n" +
                    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n" +
                    "insert {\n" +
                    "  graph <" + targetGraph + "> {\n" +
                    "?obj rdfs:label ?label2 .\n" +
                    "  }\n" +
                    "}\n" +
                    " WHERE {\n" +
                    "  ?obj rdfs:label ?label2 .\n" +
                    "  {graph <" + targetGraph + ">{\n" +
                    "       ?sub ?p ?obj .\n" +
                    "} \n" +
                    "  }\n" +
                    "}"
                AlignmentUtil.execSparql(self.params.targetSource, query, function (err, result) {
                    if (err) {
                        self.myBotEngine.error(err.responseText || err)
                        return self.myBotEngine.end()
                    }
                    self.myBotEngine.message("Labels created")
                    self.myBotEngine.nextStep();
                })


            } else {
                self.myBotEngine.nextStep();
            }
        },
        createSuperClassFn: function () {
            var superClass = prompt("Create Classes SuperClass   in" + self.params.targetSource, "owl:Thing")
            if (superClass) {
                if (superClass.startsWith("http")) {
                    superClass = "<" + superClass + ">"
                }
                var targetGraph = Config.sources[self.params.targetSource].graphUri
                var query = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n" +
                    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n" +
                    "insert {\n" +
                    "  graph <" + targetGraph + "> {\n" +
                    "?obj rdfs:subClassOf " + superClass + " .\n" +
                    "  }\n" +
                    "}\n" +
                    " WHERE {\n" +
                    "  ?obj rdfs:label ?label2 .\n" +
                    "  {graph <" + targetGraph + ">{\n" +
                    "       ?sub ?p ?obj .\n" +
                    "} \n" +
                    "  }\n" +
                    "}"
                AlignmentUtil.execSparql(self.params.targetSource, query, function (err, result) {
                    if (err) {
                        self.myBotEngine.error(err.responseText || err)
                        return self.myBotEngine.end()
                    }
                    self.myBotEngine.message("Labels created")
                    self.myBotEngine.nextStep();
                })


            } else {
                self.myBotEngine.nextStep();
            }
        },
        reindexGraphFn:function(){
            SearchUtil.generateElasticIndex(
                source,
                {
                    indexProperties: 1,
                    indexNamedIndividuals: 1,
                    skipIndividuals: skipIndividuals,
                },
                function (err, _result) {
                    if (err) {
                        self.myBotEngine.error(err.responseText || err)
                        return self.myBotEngine.end()
                    }
                    self.myBotEngine.message("Indexation done")
                    self.myBotEngine.nextStep();
                },
            );

        },

    };

    return self;
})();

export default Alignment_bot;
window.Alignment_bot = Alignment_bot;
