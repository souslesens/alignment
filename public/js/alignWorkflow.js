// Alignement alignment workflow, downstream of AlignementMakeSimilars.bulkSimilars.
// Results are GROUPED BY SOURCE (like the `str` view): a source never repeats across rows.
// 1) split candidate pairs into exact (case + English plural) vs non-exact
// 2) render exact pairs in a checkbox jsTree grouped by source (parent = source, children = targets)
// 3) generate owl:equivalentClass triples for the validated (checked) pairs
// 4) display the remaining non-exact pairs grouped by source (input for the LLM step)
import { matchesCaseAndPlural } from "./matchUtils.js";

var AlignementWorkflow = (function () {
    var self = {};

    var OWL_EQUIVALENT_CLASS = "http://www.w3.org/2002/07/owl#equivalentClass";
    var NODE_ID_SEPARATOR = " ||| ";
    // Left-panel (framed zone) container for the AI-step action buttons (save/export), kept out of the
    // result panel so the result list can use the full height.
    var AI_STEP_BUTTONS_DIV_ID = "Alignement_aiStepBtnDiv";

    self._pairByNodeId = {};
    self._validationDivId = null;
    // equivalentClass pairs already created in this session (key = srcUri + NODE_ID_SEPARATOR + tgtUri),
    // so the standalone "generate equivalent class" button only creates the missing ones on repeated clicks.
    self._createdEquivKeys = {};
    // Definitions of the non-exact classes, fetched from SousLeSens: { from: [{uri,label,definition}], target: [...] }
    self.definitions = null;

    // Number of class URIs per SPARQL query (keeps the GET URL short enough).
    var DEFINITIONS_BATCH_SIZE = 60;
    // Predicate-name fragments that identify a textual definition (mirrors Sparql_common.isTripleObjectString).
    var DEFINITION_PREDICATE_HINTS = ["definition", "comment", "description"];

    /**
     * Escapes a string for safe HTML insertion.
     * @param {string} str - The raw string.
     * @returns {string} The escaped string.
     */
    function escapeHtml(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /**
     * Escapes a string for use inside a regular expression (for exact column filtering).
     * @param {string} str - The raw string.
     * @returns {string} The escaped string.
     */
    function escapeRegExp(str) {
        return String(str == null ? "" : str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /**
     * Formats a numeric score with one decimal, or an empty string when absent.
     * @param {number} score - The ElasticSearch score.
     * @returns {string} The formatted score.
     */
    function formatScore(score) {
        if (score == null) {
            return "";
        }
        return Number(score).toFixed(1);
    }

    /**
     * Group key (the source) for a pair: its URI when present, else its label.
     * @param {Object} pair - A candidate pair.
     * @returns {string} The parent/group id.
     */
    function sourceKey(pair) {
        if (pair.srcUri) {
            return pair.srcUri;
        }
        return pair.srcLabel;
    }

    /**
     * Builds the jsTree child node id for a pair (source key + target URI).
     * @param {Object} pair - A candidate pair.
     * @returns {string} The node id.
     */
    function pairNodeId(pair) {
        return sourceKey(pair) + NODE_ID_SEPARATOR + pair.tgtUri;
    }

    /**
     * Groups pairs by source. Preserves first-seen order.
     * @param {Array} pairs - Candidate pairs.
     * @returns {Array} [{ key, label, pairs: [] }]
     */
    function groupBySource(pairs) {
        var order = [];
        var byKey = {};
        (pairs || []).forEach(function (pair) {
            var key = sourceKey(pair);
            if (!byKey[key]) {
                byKey[key] = { key: key, label: pair.srcLabel, pairs: [] };
                order.push(key);
            }
            byKey[key].pairs.push(pair);
        });
        return order.map(function (key) {
            return byKey[key];
        });
    }

    /**
     * Splits AlignementMakeSimilars candidate pairs into exact vs non-exact matches.
     * @param {Object} bulkSimilars - { srcLabel: { tgtUri: { label, score } } }
     * @param {Object} fromWordsMap - { srcLabel: srcUri }
     * @returns {{exact: Array, nonExact: Array}} Pairs { srcUri, srcLabel, tgtUri, tgtLabel, score }.
     */
    self.splitExactMatches = function (bulkSimilars, fromWordsMap) {
        var exact = [];
        var nonExact = [];
        var bulk = bulkSimilars || {};
        var fromMap = fromWordsMap || {};
        Object.keys(bulk).forEach(function (srcLabel) {
            var srcUri = fromMap[srcLabel];
            if (!srcUri) {
                srcUri = null;
            }
            var targets = bulk[srcLabel] || {};
            Object.keys(targets).forEach(function (tgtUri) {
                var pair = {
                    srcUri: srcUri,
                    srcLabel: srcLabel,
                    tgtUri: tgtUri,
                    tgtLabel: targets[tgtUri].label,
                    score: targets[tgtUri].score,
                };
                if (matchesCaseAndPlural(srcLabel, pair.tgtLabel)) {
                    exact.push(pair);
                } else {
                    nonExact.push(pair);
                }
            });
        });
        return { exact: exact, nonExact: nonExact };
    };

    /**
     * Renders exact pairs as a flat checkbox jsTree: one node per pair, two aligned columns
     * (source label | target label | score), all checked by default. Unchecking a pair excludes it
     * from equivalentClass generation.
     * @param {string} divId - The container div id for the jsTree.
     * @param {Array} exactPairs - The exact pairs to display.
     * @param {Object} [headerInfo] - { headerDivId, sourceName, targetName } for the dynamic header line.
     * @param {function} [onReady] - Called once the tree is loaded and checked.
     * @returns {void}
     */
    self.renderValidation = function (divId, exactPairs, headerInfo, onReady) {
        self._validationDivId = divId;
        self._pairByNodeId = {};
        // A fresh validation (new "list similars") starts idempotency tracking from scratch.
        self._createdEquivKeys = {};
        // Hide the AI-step action buttons from any previous run (they belong to later steps).
        $("#" + AI_STEP_BUTTONS_DIV_ID).hide();
        // Reveal this step's section (hidden by default so steps appear in sequence).
        $("#" + divId).parent().show();

        // Column header: source name | target source name | score (aligned with the node columns).
        if (headerInfo && headerInfo.headerDivId) {
            var sourceName = headerInfo.sourceName;
            if (!sourceName) {
                sourceName = "source";
            }
            var targetName = headerInfo.targetName;
            if (!targetName) {
                targetName = "target";
            }
            var headerHtml = "<span style='display:inline-block;min-width:220px'>" + escapeHtml(sourceName) + "</span>";
            headerHtml += "<span style='display:inline-block;min-width:220px'>" + escapeHtml(targetName) + "</span>";
            headerHtml += "<span>score</span>";
            $("#" + headerInfo.headerDivId).html(headerHtml);
        }

        // Flat: one checkable node per pair, two aligned columns (source label | target label | score).
        var jstreeData = [];
        exactPairs.forEach(function (pair) {
            var nodeId = pairNodeId(pair);
            self._pairByNodeId[nodeId] = pair;
            var text = "<span style='display:inline-block;min-width:220px'>" + escapeHtml(pair.srcLabel) + "</span>";
            text += "<span style='display:inline-block;min-width:220px'>" + escapeHtml(pair.tgtLabel) + "</span>";
            text += "<span style='color:#888'>" + formatScore(pair.score) + "</span>";
            jstreeData.push({
                id: nodeId,
                parent: "#",
                text: text,
                data: { type: "pair", pair: pair },
            });
        });

        var options = { withCheckboxes: true };
        window.JstreeWidget.loadJsTree(divId, jstreeData, options, function () {
            var tree = $("#" + divId).jstree(true);
            if (tree && tree.check_all) {
                tree.check_all();
            }
            if (onReady) {
                onReady();
            }
        });
    };

    /**
     * Reads the validation jsTree and splits PAIR nodes into checked (validated) and unchecked.
     * Parent (source) nodes are ignored; only the leaf pair nodes carry equivalences.
     * @param {string} [divId] - The container div id (defaults to the last rendered one).
     * @returns {{checked: Array, unchecked: Array}} The validated and excluded pairs.
     */
    self.getValidatedSplit = function (divId) {
        var targetDiv = divId;
        if (!targetDiv) {
            targetDiv = self._validationDivId;
        }
        var tree = $("#" + targetDiv).jstree(true);
        var checkedIds = [];
        if (tree) {
            checkedIds = tree.get_checked();
        }
        var checkedSet = {};
        checkedIds.forEach(function (id) {
            checkedSet[id] = 1;
        });

        var checked = [];
        var unchecked = [];
        Object.keys(self._pairByNodeId).forEach(function (nodeId) {
            var pair = self._pairByNodeId[nodeId];
            if (checkedSet[nodeId]) {
                checked.push(pair);
            } else {
                unchecked.push(pair);
            }
        });
        return { checked: checked, unchecked: unchecked };
    };

    /**
     * Inserts owl:equivalentClass triples (source class -> target class) for the given pairs,
     * written into the source's named graph.
     * @param {string} source - The source (source 1) whose graph receives the triples.
     * @param {Array} pairs - Validated pairs with srcUri / tgtUri.
     * @param {function} callback - callback(err, insertedCount).
     * @returns {void}
     */
    self.generateEquivalentClasses = function (source, pairs, callback) {
        if (!pairs || pairs.length === 0) {
            return callback(null, 0);
        }
        var triples = [];
        pairs.forEach(function (pair) {
            if (pair.srcUri && pair.tgtUri) {
                triples.push({ subject: pair.srcUri, predicate: OWL_EQUIVALENT_CLASS, object: pair.tgtUri });
            }
        });
        if (triples.length === 0) {
            return callback(null, 0);
        }
        window.Sparql_generic.insertTriples(source, triples, {}, function (err) {
            if (err) {
                return callback(err);
            }
            callback(null, triples.length);
        });
    };

    /**
     * Like generateEquivalentClasses but idempotent across clicks: pairs already created in this session
     * (tracked in self._createdEquivKeys) are skipped, so clicking the button twice only creates the new ones.
     * @param {string} source - The source whose graph receives the triples.
     * @param {Array} pairs - Checked pairs with srcUri / tgtUri.
     * @param {function} callback - callback(err, { created, skipped }).
     * @returns {void}
     */
    self.generateEquivalentClassesIdempotent = function (source, pairs, callback) {
        var pairsToCreate = [];
        var skippedCount = 0;
        (pairs || []).forEach(function (pair) {
            if (!pair.srcUri || !pair.tgtUri) {
                return;
            }
            var key = pair.srcUri + NODE_ID_SEPARATOR + pair.tgtUri;
            if (self._createdEquivKeys[key]) {
                skippedCount += 1;
                return;
            }
            pairsToCreate.push(pair);
        });
        if (pairsToCreate.length === 0) {
            return callback(null, { created: 0, skipped: skippedCount });
        }
        self.generateEquivalentClasses(source, pairsToCreate, function (err, insertedCount) {
            if (err) {
                return callback(err);
            }
            pairsToCreate.forEach(function (pair) {
                var key = pair.srcUri + NODE_ID_SEPARATOR + pair.tgtUri;
                self._createdEquivKeys[key] = 1;
            });
            callback(null, { created: insertedCount, skipped: skippedCount });
        });
    };

    /**
     * Renders the standalone "generate equivalent class" button. Its ONLY action is to create
     * owl:equivalentClass triples for the currently-checked exact pairs; it does NOT advance the bot.
     * Idempotent: repeated clicks only create pairs not already created in this session.
     * @param {string} divId - The button container div id.
     * @param {string} source - The source whose graph receives the triples.
     * @returns {void}
     */
    self.renderGenerateEquivButton = function (divId, source) {
        var buttonId = divId + "_btn";
        $("#" + divId)
            .html("<button id='" + buttonId + "'>generate equivalent class</button>")
            .show();
        $("#" + buttonId)
            .off("click")
            .on("click", function () {
                var split = self.getValidatedSplit();
                self.generateEquivalentClassesIdempotent(source, split.checked, function (err, result) {
                    if (err) {
                        var message = err.message;
                        if (!message) {
                            message = err;
                        }
                        window.UI.message("Error inserting equivalentClass: " + message, true);
                        return;
                    }
                    var message = result.created + " equivalent classes created";
                    if (result.skipped > 0) {
                        message += " (" + result.skipped + " already created, skipped)";
                    }
                    window.UI.message(message + " in " + source, true);
                });
            });
    };

    /**
     * Renders the non-exact pairs GROUPED BY SOURCE (one row per source, its targets listed).
     * @param {string} divId - The container div id.
     * @param {Array} nonExactPairs - The non-exact pairs.
     * @returns {void}
     */
    self.renderNonExact = function (divId, nonExactPairs) {
        // Reveal this step's section (hidden until "Generate equivalent classes" has run).
        $("#" + divId).parent().show();
        var pairs = nonExactPairs || [];
        if (pairs.length === 0) {
            $("#" + divId).html("<i>no non-exact matches</i>");
            return;
        }
        // Three columns only: source | target | score (one row per pair, nothing else).
        var html = "<table style='border-collapse:collapse;width:100%;'>";
        html += "<thead><tr><th style='text-align:left;border-bottom:1px solid #ccc;'>source</th>";
        html += "<th style='text-align:left;border-bottom:1px solid #ccc;'>target</th>";
        html += "<th style='text-align:right;border-bottom:1px solid #ccc;'>score</th></tr></thead><tbody>";
        pairs.forEach(function (pair) {
            html += "<tr><td>" + escapeHtml(pair.srcLabel) + "</td>";
            html += "<td>" + escapeHtml(pair.tgtLabel) + "</td>";
            html += "<td style='text-align:right;'>" + formatScore(pair.score) + "</td></tr>";
        });
        html += "</tbody></table>";
        $("#" + divId).html(html);
    };

    /**
     * Builds the SPARQL SELECT returning a textual definition for a batch of class URIs of one source.
     * Keeps any predicate whose name contains "definition", "comment" or "description".
     * @param {string} source - The source name (key of Config.sources).
     * @param {Array} uris - Class URIs for this batch.
     * @returns {string} The SPARQL query.
     */
    function buildDefinitionsQuery(source, uris) {
        var fromStr = window.Sparql_common.getFromStr(source);
        var values = uris
            .map(function (u) {
                return "<" + u + ">";
            })
            .join(" ");
        var predFilters = DEFINITION_PREDICATE_HINTS.map(function (hint) {
            return "CONTAINS(LCASE(STR(?p)), \"" + hint + "\")";
        }).join(" || ");
        var query = "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ";
        query += "SELECT DISTINCT ?class ?def " + fromStr + " WHERE { ";
        query += "VALUES ?class { " + values + " } ";
        query += "?class ?p ?def . ";
        query += "FILTER(isLiteral(?def)) ";
        query += "FILTER(" + predFilters + ") ";
        query += "} LIMIT 10000";
        return query;
    }

    /**
     * Fetches the first textual definition found for each class URI of a single source, in batches.
     * @param {string} source - The source name.
     * @param {Array} classUris - The class URIs to look up.
     * @param {function} callback - callback(err, { uri: definitionText }).
     * @returns {void}
     */
    self.fetchDefinitions = function (source, classUris, callback) {
        var definitionsByUri = {};
        if (!classUris || classUris.length === 0) {
            return callback(null, definitionsByUri);
        }
        var serverUrl = window.Config.sources[source].sparql_server.url;
        var url = serverUrl + "?format=json&query=";
        if (window.Config.sources[source].sparql_server.no_params) {
            url = serverUrl;
        }
        var index = 0;
        function nextBatch() {
            if (index >= classUris.length) {
                return callback(null, definitionsByUri);
            }
            var batch = classUris.slice(index, index + DEFINITIONS_BATCH_SIZE);
            index += DEFINITIONS_BATCH_SIZE;
            var query = buildDefinitionsQuery(source, batch);
            window.Sparql_proxy.querySPARQL_GET_proxy(url, query, "", { source: source }, function (err, result) {
                if (err) {
                    return callback(err);
                }
                result.results.bindings.forEach(function (binding) {
                    var uri = binding.class.value;
                    // Keep the first non-empty definition found per class.
                    if (!definitionsByUri[uri] && binding.def && binding.def.value) {
                        definitionsByUri[uri] = binding.def.value;
                    }
                });
                nextBatch();
            });
        }
        nextBatch();
    };

    /**
     * Builds the in-memory definitions structure for the classes involved in the non-exact pairs
     * (source + target): fetches each class definition from SousLeSens and stores it in self.definitions.
     * Not displayed — this data feeds the upcoming LLM classification step.
     * @param {string} fromSource - Source-from name.
     * @param {string} targetSource - Target source name.
     * @param {Array} pairs - Non-exact pairs ({ srcUri, srcLabel, tgtUri, tgtLabel }).
     * @param {function} callback - callback(err, definitions).
     * @returns {void}
     */
    self.buildDefinitions = function (fromSource, targetSource, pairs, callback) {
        var fromLabelByUri = {};
        var targetLabelByUri = {};
        (pairs || []).forEach(function (pair) {
            if (pair.srcUri) {
                fromLabelByUri[pair.srcUri] = pair.srcLabel;
            }
            if (pair.tgtUri) {
                targetLabelByUri[pair.tgtUri] = pair.tgtLabel;
            }
        });
        var fromUris = Object.keys(fromLabelByUri);
        var targetUris = Object.keys(targetLabelByUri);

        self.fetchDefinitions(fromSource, fromUris, function (errFrom, fromDefs) {
            if (errFrom) {
                return callback(errFrom);
            }
            self.fetchDefinitions(targetSource, targetUris, function (errTarget, targetDefs) {
                if (errTarget) {
                    return callback(errTarget);
                }
                var definitions = { from: [], target: [] };
                fromUris.forEach(function (uri) {
                    var def = fromDefs[uri];
                    if (!def) {
                        def = "";
                    }
                    definitions.from.push({ uri: uri, label: fromLabelByUri[uri], definition: def });
                });
                targetUris.forEach(function (uri) {
                    var def = targetDefs[uri];
                    if (!def) {
                        def = "";
                    }
                    definitions.target.push({ uri: uri, label: targetLabelByUri[uri], definition: def });
                });
                self.definitions = definitions;
                callback(null, definitions);
            });
        });
    };

    /**
     * Renders the AI-treatment result: model, token usage and per-category counts, then the per-pair
     * classification as a DataTable (built-in search filter + CSV export) whose first two columns are
     * named after the real source/target (CFIHOS / UNSPSC), followed by "ai category" and "reason".
     * @param {string} divId - The container div id.
     * @param {Object} response - The /api/v1/alignment response.
     * @param {string} fromSource - Source-from name (used as the first column header).
     * @param {string} targetSource - Target source name (used as the second column header).
     * @returns {void}
     */
    function renderAiTreatment(divId, response, fromSource, targetSource) {
        $("#" + divId).parent().show();
        var counts = response.counts || {};
        var usage = response.usage || {};
        var inputTokens = usage.input_tokens || 0;
        var outputTokens = usage.output_tokens || 0;
        var totalTokens = inputTokens + outputTokens;

        var infoHtml = "<div style='margin-bottom:6px;'>";
        infoHtml += "<b>Model:</b> " + escapeHtml(response.model || "") + "<br>";
        infoHtml += "<b>Tokens used:</b> " + totalTokens + " (" + inputTokens + " in + " + outputTokens + " out)</div>";

        infoHtml += "<div style='margin-bottom:6px;'>";
        ["Exact match AI", "SubclassOf", "SubclassOf inverse", "Not match", "Unknown", "Other"].forEach(function (category) {
            var value = counts[category];
            if (!value) {
                value = 0;
            }
            infoHtml += "<span style='margin-right:12px;'>" + escapeHtml(category) + ": <b>" + value + "</b></span>";
        });
        infoHtml += "</div>";

        if (response.parseError) {
            infoHtml += "<div style='color:#c00;'>parse error: " + escapeHtml(response.parseError) + "</div>";
        }
        // Excel-like filter: a dropdown to keep only one ai category (built from the categories present).
        var presentCategories = [];
        var seenCategory = {};
        (response.classifications || []).forEach(function (item) {
            var category = item.category;
            if (category && !seenCategory[category]) {
                seenCategory[category] = true;
                presentCategories.push(category);
            }
        });
        var selectId = divId + "_catFilter";
        infoHtml += "<div style='margin:6px 0;'><label style='margin-right:6px;'><b>ai category:</b></label>";
        infoHtml += "<select id='" + selectId + "'><option value=''>(all)</option>";
        presentCategories.forEach(function (category) {
            infoHtml += "<option value='" + escapeHtml(category) + "'>" + escapeHtml(category) + "</option>";
        });
        infoHtml += "</select></div>";

        // Dedicated sub-div for the DataTable (Export.showDataTable replaces its content).
        infoHtml += "<div id='" + divId + "_table'></div>";
        $("#" + divId).html(infoHtml);

        var fromName = fromSource;
        if (!fromName) {
            fromName = "source";
        }
        var targetName = targetSource;
        if (!targetName) {
            targetName = "target";
        }
        // 4 named columns: <source name (CFIHOS)> | <target name (UNSPSC)> | ai category | reason.
        var cols = [
            { title: fromName, defaultContent: "" },
            { title: targetName, defaultContent: "" },
            { title: "ai category", defaultContent: "" },
            { title: "reason", defaultContent: "" },
        ];
        var dataSet = (response.classifications || []).map(function (item) {
            return [item.srcLabel || "", item.tgtLabel || "", item.category || "", item.reason || ""];
        });
        if (dataSet.length === 0) {
            return;
        }
        // "Brtip" dom = Buttons (Export CSV/copy) + table + info + paging, WITHOUT the global search box.
        window.Export.showDataTable(divId + "_table", cols, dataSet, "Brtip", {
            dataTableDivId: "Alignement_aiTable",
            paging: true,
            height: "auto",
            width: "100%",
        });

        // Wire the dropdown to filter the "ai category" column (index 2) on an exact match.
        var aiTable = window.Export.dataTable;
        $("#" + selectId).on("change", function () {
            var value = $(this).val();
            if (!value) {
                aiTable.column(2).search("").draw();
            } else {
                aiTable.column(2).search("^" + escapeRegExp(value) + "$", true, false).draw();
            }
        });
    }

    /**
     * Runs the AI treatment: POSTs the non-exact pairs and the definitions table to the AI route
     * (single model = the one configured in mainConfig.llm), stores the result in self.aiTreatment
     * and renders it (model, token usage, per-category counts and the per-pair classification table).
     * @param {string} fromSource - Source-from name (unused server-side but kept for symmetry/logging).
     * @param {string} targetSource - Target source name.
     * @param {Array} nonExacts - Non-exact pairs.
     * @param {Object} definitions - { from: [...], target: [...] }.
     * @param {string} divId - The container div id for the result.
     * @param {function} callback - callback(err, response).
     * @returns {void}
     */
    self.runAiTreatment = function (fromSource, targetSource, nonExacts, definitions, divId, callback) {
        var payload = {
            nonExacts: nonExacts,
            definitions: definitions,
        };
        $.ajax({
            url: window.Config.apiUrl + "/alignment",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(payload),
            dataType: "json",
            success: function (response) {
                // Keep the source/target names with the result for the DataTable headers and later export.
                response.fromSource = fromSource;
                response.targetSource = targetSource;
                self.aiTreatment = response;
                renderAiTreatment(divId, response, fromSource, targetSource);
                callback(null, response);
            },
            error: function (jqXHR) {
                var message = "AI treatment failed";
                if (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) {
                    message = jqXHR.responseJSON.error;
                }
                callback(new Error(message));
            },
        });
    };

    // ── AI-classification post-processing (equivalent / subclass / export) ──────

    var RDFS_SUBCLASSOF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";

    /**
     * Enriches LLM classifications (label-only) with the srcUri/tgtUri recovered from the original
     * non-exact pairs, matched on (srcLabel, tgtLabel).
     * @param {Array} classifications - [{ srcLabel, tgtLabel, category, reason }].
     * @param {Array} pairs - Non-exact pairs with { srcUri, srcLabel, tgtUri, tgtLabel }.
     * @returns {Array} Enriched items [{ srcUri, srcLabel, tgtUri, tgtLabel, category, reason }].
     */
    self.enrichWithUris = function (classifications, pairs) {
        var pairByLabels = {};
        (pairs || []).forEach(function (pair) {
            var key = pair.srcLabel + NODE_ID_SEPARATOR + pair.tgtLabel;
            if (!pairByLabels[key]) {
                pairByLabels[key] = pair;
            }
        });
        var enriched = [];
        (classifications || []).forEach(function (classification) {
            var key = classification.srcLabel + NODE_ID_SEPARATOR + classification.tgtLabel;
            var pair = pairByLabels[key];
            var srcUri = null;
            var tgtUri = null;
            if (pair) {
                srcUri = pair.srcUri;
                tgtUri = pair.tgtUri;
            }
            enriched.push({
                srcUri: srcUri,
                srcLabel: classification.srcLabel,
                tgtUri: tgtUri,
                tgtLabel: classification.tgtLabel,
                category: classification.category,
                reason: classification.reason,
            });
        });
        return enriched;
    };

    /**
     * Splits enriched classifications into per-category buckets.
     * @param {Array} enriched - Enriched items with a `category`.
     * @returns {Object} { exactAi, subclassOf, subclassOfInverse, notMatch, unknown, other }.
     */
    self.splitByAiCategory = function (enriched) {
        var buckets = { exactAi: [], subclassOf: [], subclassOfInverse: [], notMatch: [], unknown: [], other: [] };
        (enriched || []).forEach(function (item) {
            var category = String(item.category || "").trim().toLowerCase();
            if (category === "exact match ai") {
                buckets.exactAi.push(item);
            } else if (category === "subclassof") {
                buckets.subclassOf.push(item);
            } else if (category === "subclassof inverse") {
                buckets.subclassOfInverse.push(item);
            } else if (category === "not match") {
                buckets.notMatch.push(item);
            } else if (category === "unknown") {
                buckets.unknown.push(item);
            } else {
                buckets.other.push(item);
            }
        });
        return buckets;
    };

    /**
     * Renders a flat, all-checked jsTree of pairs (source | target | category) into divId.
     * @param {string} divId - The tree container div id.
     * @param {Array} pairs - Enriched pairs.
     * @param {function} onReady - Called once the tree is loaded and checked.
     * @returns {void}
     */
    self.renderAiCheckTree = function (divId, pairs, onReady) {
        if (!self._aiPairByNodeIdByDiv) {
            self._aiPairByNodeIdByDiv = {};
        }
        var pairByNodeId = {};
        self._aiPairByNodeIdByDiv[divId] = pairByNodeId;
        var jstreeData = [];
        pairs.forEach(function (pair) {
            var nodeId = pairNodeId(pair);
            pairByNodeId[nodeId] = pair;
            var text = "<span style='display:inline-block;min-width:200px'>" + escapeHtml(pair.srcLabel) + "</span>";
            text += "<span style='display:inline-block;min-width:200px'>" + escapeHtml(pair.tgtLabel) + "</span>";
            text += "<span style='display:inline-block;min-width:140px;color:#888'>" + escapeHtml(pair.category) + "</span>";
            text += "<span style='color:#555'>" + escapeHtml(pair.reason) + "</span>";
            jstreeData.push({ id: nodeId, parent: "#", text: text, data: { type: "pair", pair: pair } });
        });
        var options = { withCheckboxes: true };
        window.JstreeWidget.loadJsTree(divId, jstreeData, options, function () {
            var tree = $("#" + divId).jstree(true);
            if (tree && tree.check_all) {
                tree.check_all();
            }
            if (onReady) {
                onReady();
            }
        });
    };

    /**
     * Reads an AI-check tree and splits its pairs into checked / unchecked (per-div map, safe if absent).
     * @param {string} divId - The tree container div id.
     * @returns {{checked: Array, unchecked: Array}}
     */
    self.getAiCheckSplit = function (divId) {
        var pairByNodeId = {};
        if (self._aiPairByNodeIdByDiv && self._aiPairByNodeIdByDiv[divId]) {
            pairByNodeId = self._aiPairByNodeIdByDiv[divId];
        }
        var tree = $("#" + divId).jstree(true);
        var checkedSet = {};
        if (tree && tree.get_checked) {
            tree.get_checked().forEach(function (id) {
                checkedSet[id] = 1;
            });
        }
        var checked = [];
        var unchecked = [];
        Object.keys(pairByNodeId).forEach(function (nodeId) {
            var pair = pairByNodeId[nodeId];
            if (checkedSet[nodeId]) {
                checked.push(pair);
            } else {
                unchecked.push(pair);
            }
        });
        return { checked: checked, unchecked: unchecked };
    };

    /**
     * Renders a validation step: a pre-checked jsTree of pairs + "Enregistrer" / "Exporter (CSV)" buttons.
     * @param {string} divId - The step container div id.
     * @param {Array} pairs - Pairs to display (all pre-checked).
     * @param {Object} options - { title }.
     * @param {function} onSave - Called with the tree div id when "Enregistrer" is clicked.
     * @param {function} onExport - Called with the tree div id when "Exporter" is clicked.
     * @returns {void}
     */
    self.renderAiValidationStep = function (divId, pairs, options, handlers) {
        $("#" + divId).parent().show();
        var treeDivId = divId + "_tree";
        var saveBtnId = divId + "_save";
        var exportBtnId = divId + "_export";
        var title = "";
        var sourceName = "source";
        var targetName = "target";
        var saveLabel = "Enregistrer";
        if (options) {
            if (options.title) {
                title = options.title;
            }
            if (options.sourceName) {
                sourceName = options.sourceName;
            }
            if (options.targetName) {
                targetName = options.targetName;
            }
            if (options.saveLabel) {
                saveLabel = options.saveLabel;
            }
        }
        // Right (framed) panel: title + column header + full-height tree. The two action buttons go to the
        // left panel (AI_STEP_BUTTONS_DIV_ID) so the list can use the full height.
        var html = "<div style='display:flex;flex-direction:column;height:100%;'>";
        if (title) {
            html += "<div style='margin-bottom:4px;font-weight:bold;flex:0 0 auto;'>" + escapeHtml(title) + " (" + pairs.length + ")</div>";
        }
        // Column header aligned with the jstree node columns (left padding for the checkbox + icon).
        html += "<div style='font-weight:bold;border-bottom:1px solid #ccc;padding:2px 0 2px 44px;flex:0 0 auto;'>";
        html += "<span style='display:inline-block;min-width:200px'>" + escapeHtml(sourceName) + "</span>";
        html += "<span style='display:inline-block;min-width:200px'>" + escapeHtml(targetName) + "</span>";
        html += "<span style='display:inline-block;min-width:140px'>type</span>";
        html += "<span>reason</span>";
        html += "</div>";
        html += "<div id='" + treeDivId + "' style='flex:1 1 auto;min-height:0;overflow:auto;'></div>";
        html += "</div>";
        $("#" + divId).html(html);

        // Left panel (framed zone): the two action buttons.
        var buttonsHtml = "<button id='" + saveBtnId + "' style='margin-right:6px;'>" + escapeHtml(saveLabel) + "</button>";
        buttonsHtml += "<button id='" + exportBtnId + "'>Exporter (CSV)</button>";
        $("#" + AI_STEP_BUTTONS_DIV_ID)
            .html(buttonsHtml)
            .show();

        // Save / Export act on the current selection WITHOUT advancing (advancing is a bot-bubble step).
        $("#" + saveBtnId)
            .off("click")
            .on("click", function () {
                handlers.onSave(treeDivId);
            });
        $("#" + exportBtnId)
            .off("click")
            .on("click", function () {
                handlers.onExport(treeDivId);
            });

        self.renderAiCheckTree(treeDivId, pairs, null);
    };

    /**
     * Inserts rdfs:subClassOf triples for the given pairs. For "SubclassOf" the source is a subclass of
     * the target; for "SubclassOf inverse" the target is a subclass of the source (source = superclass).
     * @param {string} source - The source whose graph receives the triples.
     * @param {Array} pairs - Pairs with srcUri / tgtUri / category.
     * @param {function} callback - callback(err, insertedCount).
     * @returns {void}
     */
    self.generateSubClasses = function (source, pairs, callback) {
        if (!pairs || pairs.length === 0) {
            return callback(null, 0);
        }
        var triples = [];
        pairs.forEach(function (pair) {
            if (!pair.srcUri || !pair.tgtUri) {
                return;
            }
            var category = String(pair.category || "").trim().toLowerCase();
            if (category === "subclassof inverse") {
                triples.push({ subject: pair.tgtUri, predicate: RDFS_SUBCLASSOF, object: pair.srcUri });
            } else {
                triples.push({ subject: pair.srcUri, predicate: RDFS_SUBCLASSOF, object: pair.tgtUri });
            }
        });
        if (triples.length === 0) {
            return callback(null, 0);
        }
        window.Sparql_generic.insertTriples(source, triples, {}, function (err) {
            if (err) {
                return callback(err);
            }
            callback(null, triples.length);
        });
    };

    /**
     * Escapes a value for a semicolon-separated CSV cell.
     * @param {*} value
     * @returns {string}
     */
    function toCsvCell(value) {
        var text = String(value == null ? "" : value);
        if (text.indexOf(";") !== -1 || text.indexOf('"') !== -1 || text.indexOf("\n") !== -1 || text.indexOf("\r") !== -1) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    }

    /**
     * Triggers a client-side CSV download of the given pairs.
     * @param {Array} pairs - The rows.
     * @param {Array} columns - [{ header, field }].
     * @param {string} fileName - The download file name.
     * @returns {void}
     */
    self.exportPairsToCsv = function (pairs, columns, fileName) {
        var lines = [];
        var headerCells = columns.map(function (column) {
            return toCsvCell(column.header);
        });
        lines.push(headerCells.join(";"));
        (pairs || []).forEach(function (pair) {
            var cells = columns.map(function (column) {
                return toCsvCell(pair[column.field]);
            });
            lines.push(cells.join(";"));
        });
        var csv = lines.join("\r\n");
        var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    /**
     * Renders the final "remaining" step: a read-only table + a single "Exporter (CSV)" button.
     * @param {string} divId - The container div id.
     * @param {Array} pairs - Remaining pairs.
     * @param {string} fromSource - Source-from name (column header).
     * @param {string} targetSource - Target source name (column header).
     * @param {function} onExport - Called when "Exporter" is clicked.
     * @returns {void}
     */
    self.renderRemaining = function (divId, pairs, fromSource, targetSource, onExport) {
        $("#" + divId).parent().show();
        var exportBtnId = divId + "_export";
        var fromName = fromSource || "source";
        var targetName = targetSource || "target";
        var html = "<div style='margin-bottom:4px;font-weight:bold;'>Reste à exporter (Not match / Unknown / Other / décochés) — " + pairs.length + " lignes</div>";
        html += "<table style='border-collapse:collapse;width:100%;'><thead><tr>";
        html += "<th style='text-align:left;border-bottom:1px solid #ccc;'>" + escapeHtml(fromName) + "</th>";
        html += "<th style='text-align:left;border-bottom:1px solid #ccc;'>" + escapeHtml(targetName) + "</th>";
        html += "<th style='text-align:left;border-bottom:1px solid #ccc;'>ai category</th>";
        html += "<th style='text-align:left;border-bottom:1px solid #ccc;'>reason</th>";
        html += "</tr></thead><tbody>";
        (pairs || []).forEach(function (pair) {
            html += "<tr><td style='vertical-align:top;'>" + escapeHtml(pair.srcLabel) + "</td>";
            html += "<td style='vertical-align:top;'>" + escapeHtml(pair.tgtLabel) + "</td>";
            html += "<td style='vertical-align:top;white-space:nowrap;'>" + escapeHtml(pair.category) + "</td>";
            html += "<td>" + escapeHtml(pair.reason) + "</td></tr>";
        });
        html += "</tbody></table>";
        $("#" + divId).html(html);

        // Left panel (framed zone): the export button.
        $("#" + AI_STEP_BUTTONS_DIV_ID)
            .html("<button id='" + exportBtnId + "'>Exporter (CSV)</button>")
            .show();
        $("#" + exportBtnId)
            .off("click")
            .on("click", function () {
                onExport();
            });
    };

    return self;
})();

export default AlignementWorkflow;
if (typeof window !== "undefined") {
    window.AlignementWorkflow = AlignementWorkflow;
}
