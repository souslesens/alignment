import Alignment_bot from "./alignment_bot.js";
import AlignmentUtil from "./alignmentUtil.js"

var AlignmentMakeSimilars = (function () {

    var self = {}
    self.containers = false;// use containers insteadof subClasses
    // Orphans tab — dialog actions: predicate for "create equivalent class" and target source for "create uri".
    var OWL_EQUIVALENT_CLASS = "http://www.w3.org/2002/07/owl#equivalentClass";
    var ALIGNMENT_TSF_SOURCE = "ALIGNMENT_TSF";
    // Alignment output source per target source (must match config/sources.json).
    var ALIGNMENT_SOURCE_BY_TARGET = { UNSPSC: "ALIGNMENT_UNSPSC", ECLASS: "ALIGNMENT_ECLASS" };
    self.sourceContainerJstreeDivId = "containerWidget_treeDiv";
    self.openSource = function () {
        SourceSelectorWidget.initWidget(["OWL"], "mainDialogDiv", true, self.selectTreeNodeFn, null, {})
        //  self.initTargetContainers();

    }

    /**
     * Renders the target-source picker: a checkbox list of the alignable target sources
     * (UNSPSC, ECLASS). Only one can be checked at a time; the checked one becomes the
     * target and is compared against ALL of its content (no per-container selection).
     * @function
     * @name initTargetContainers
     * @memberof module:AlignmentMakeSimilars
     * @returns {void}
     */
    self.initTargetContainers = function () {
        var candidateTargetSources = ["UNSPSC", "ECLASS"];
        self.targetSources = candidateTargetSources.filter(function (targetSource) {
            return Config.sources && Config.sources[targetSource];
        });
        self.currentTargetSource = null;
        if (self.targetSources.length === 0) {
            $("#Alignment_targetContainersDiv").html("<i>no target source available (UNSPSC / ECLASS not configured on this instance)</i>");
            return;
        }
        var checkboxLines = self.targetSources.map(function (targetSource) {
            return "<div><label><input type='checkbox' class='Alignment_targetSourceCbx' value='" + targetSource + "'> " + targetSource + "</label></div>";
        });
        var checkboxesHtml = checkboxLines.join("");
        $("#Alignment_targetContainersDiv").html(checkboxesHtml);
        $(".Alignment_targetSourceCbx")
            .off("change")
            .on("change", function () {
                self.selectTargetSource(this);
            });
    }

    /**
     * Handles a target-source checkbox: enforces single selection (unchecks the others) and
     * stores the checked source as the current target (or null when none is checked).
     * @function
     * @name selectTargetSource
     * @memberof module:AlignmentMakeSimilars
     * @param {HTMLInputElement} checkbox - The checkbox that was toggled.
     * @returns {void}
     */
    self.selectTargetSource = function (checkbox) {
        $(".Alignment_targetSourceCbx").not(checkbox).prop("checked", false);
        if (checkbox.checked) {
            self.currentTargetSource = checkbox.value;
        } else {
            self.currentTargetSource = null;
        }
    }

    self.selectTreeNodeFn = function (err, obj) {

        // SourceSelectorWidget.showSourceDialog(true, function (source) {
        self.currentSource = obj.node.data.id
        $("#mainDialogDiv").dialog("close")
        Lineage_sources.loadSources(self.currentSource, function (err) {

            $("#Alignment_sourceContainersDiv").load("modules/tools/containers/containers_widget.html", function () {
                if (self.containers) {
                    var options = {
                        jstreeOptions: {selectTreeNodeFn: AlignmentMakeSimilar.selectSourceTreeNodeFn},
                        contextMenu: AlignmentMakeSimilar.getSourceContextJstreeMenu()
                    }
                    //   $("#mainDialogDiv").addClass("zIndexTop-10");
                    Containers_tree.search(self.sourceContainerJstreeDivId, self.currentSource, options);
                } else {
                    Sparql_OWL.getTopConcepts(self.currentSource, {withoutImports: true}, function (err, result) {
                        if (err) {
                            return alert(err.responseText || err)
                        }
                        var jstreeData = []
                        result.forEach(function (item) {
                            jstreeData.push({
                                id: item.topConcept.value,
                                text: item.topConceptLabel.value,
                                data: {
                                    id: item.topConcept.value,
                                    label: item.topConceptLabel.value,
                                    source: self.currentSource
                                },
                                parent: "#"
                            })
                        })
                        var options = {
                            selectTreeNodeFn: AlignmentMakeSimilar.selectSourceTreeNodeFn

                        }
                        JstreeWidget.loadJsTree(self.sourceContainerJstreeDivId, jstreeData, options)
                    })
                }


            });


        })


    }


    self.selectSourceTreeNodeFn = function (event, obj) {
        self.currentSourceContainerId = obj.node.data.id;

        if (obj.event.button != 2) {
            Containers_tree.listContainerResources(obj.node);
        }
    }
    self.getSourceContextJstreeMenu = function () {
        var items = {};
        items["NodeInfos"] = {
            label: "Node infos",
            action: function (_e) {
                NodeInfosWidget.showNodeInfos(self.currentSource, self.currentContainer, "mainDialogDiv");
            },
        };
        items["GraphNode"] = {
            label: "Graph node",
            action: function (_e) {
                if (true || self.currentContainer.data.type == "Container") {
                    Containers_graph.graphResources(self.currentSource, self.currentContainer.data, {onlyOneLevel: true});
                } else {
                    Lineage_whiteboard.drawNodesAndParents(self.currentContainer, 0);
                }
            },
        };
        return {}
    }


    self.listSimilars = function () {
        self.currentTargetSource = $("#Alignment_targetContainersDiv").jstree(true).get_selected()[0]
        var fromSource = self.currentSource;
        var toSource = self.currentTargetSource;
        var fromcontainer = self.currentSourceContainerId;

        self.allClasses = $("#Alignment_allClassesCBX").prop("checked")
        if (self.allClasses) {
            self.containers = false
        }


        if (!fromcontainer && !self.allClasses) {
            return alert("no source container selected")
        }
        if (!toSource) {
            return alert("no target source selected (check UNSPSC or ECLASS)")
        }


        var fromWordsMap = {}
        var bulkSimilars = {}
        var orphans = []
        var narrowers={}
        var firstPassOrphans = []


        function searchSimilars(toSource, wordsAll, callback) {
            var similars = {}
            var orphans = []
            var slices = common.array.slice(wordsAll, 100)

            async.eachSeries(slices, function (words, callbackEach) {


                var options = {} //{classFilterXX: "http://purl.obolibrary.org/obo/BFO_0000001"}
                SearchUtil.getElasticSearchMatches(words, [toSource.toLowerCase()], "match_phrase", 0, 10000, options, function (err, result) {
                    if (err) {
                        return callbackEach(err);
                    }

                    result.forEach(function (item, index) {
                        var fromWord = words[index]
                        var nFromWord = fromWord.split(" ").length;
                        //  bulkSimilars[fromWord] = {}
                        if (item.error) {

                            return
                        }


                        item.hits.hits.forEach(function (hit) {
                            var nToWord = hit._source.label.split(" ").length;
                            if (nFromWord >= nToWord) {

                                //keep targets with at most as many words as the source term
                                if (!similars[fromWord]) {
                                    similars[fromWord] = {}
                                }
                                similars[fromWord][hit._source.id] = {
                                    label: hit._source.label, score: hit._score
                                }
                            }else{
                                if(!narrowers[fromWord])
                                    narrowers[fromWord]= {}
                                narrowers[fromWord][hit._source.id] = {
                                    label: hit._source.label, score: hit._score
                                }
                            }

                        })
                        if (!similars[fromWord]) {
                            orphans.push(fromWord)
                        }
                    })

                    callbackEach()
                })
            }, function (err) {
              var x= narrowers
                callback(null, {similars, orphans});

            })
        }


        async.series([

            //select from alldescendants
            function (callbackSeries) {

                if (self.containers) {
                    Containers_query.getContainerDescendants(self.currentSource, fromcontainer, {leaves: true}, function (err, result) {
                        if (err) {
                            return callbackSeries(err);
                        }
                        result.results.bindings.forEach(function (item) {
                            if (item.memberLabel) {
                                fromWordsMap[item.memberLabel.value] = item.member.value
                            }
                        })

                        callbackSeries();

                    })
                } else {
                    var fromStr = Sparql_common.getFromStr(self.currentSource, false, true)
                    var filter = ""
                    if (!self.allClasses) {
                        filter = Sparql_common.setFilter("subject", [self.currentSourceContainerId])
                    }

                    var query = "PREFIX owl: <http://www.w3.org/2002/07/owl#>\n" +
                        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>" +
                        " prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>" +
                        " select   distinct * " +
                        fromStr +
                        "where  {?child1 rdfs:label ?child1Label. ?child1   rdfs:subClassOf*  ?subject. " +
                        " FILTER (!isBlank(?subject)) " +
                        filter + " }"

                    AlignmentUtil.execSparql(self.currentSource, query,function (err, result) {
                            if (err) {
                            return callbackSeries(err);
                        }

                        result.results.bindings.forEach(function (item) {
                            if (item.child1Label) {
                                fromWordsMap[item.child1Label.value] = item.child1.value
                            }
                        })

                        callbackSeries();
                    })

                }
            },
            //search similars fuzzy match


            function (callbackSeries) {
                var allWords = Object.keys(fromWordsMap)
                /*   allWords=[ "pipe reducer",
                       "trailer",
                       "container",
                       "rotary compressor",
                       "subsea control module",
                       "ball valve",
                       "distribution board",]*/

                searchSimilars(toSource, allWords, function (err, result) {
                    bulkSimilars = result.similars;
                    orphans = result.orphans
                    firstPassOrphans = result.orphans
                    callbackSeries(err)
                })

            },
            //remove first word from composed orphans
            function (callbackSeries) {


                var reducedOrphans = []
                var reducedOrphansMap = {}
                orphans.forEach(function (orphan) {
                    var tokens = orphan.split(" ");

                    if (tokens.length > 1) {
                        var word = ""
                        for (var i = 1; i < tokens.length; i++) {
                            word += tokens[i]
                            if (i < tokens.length - 1) {
                                word += " "
                            }

                        }
                        reducedOrphansMap[word.trim()] = orphan
                        reducedOrphans.push(word.trim())

                    }
                })
                searchSimilars(toSource, reducedOrphans, function (err, result) {
                    if (err) {
                        return callbackSeries(err)
                    }
                    orphans = result.orphans
                    for (var reducedWord in result.similars) {
                        var initialWord = reducedOrphansMap[reducedWord]
                        var similar = result.similars[reducedWord]
                        if (initialWord) {

                            bulkSimilars[initialWord] = similar

                        } else {

                        }
                    }

                    callbackSeries(err)
                })


            },
            //filter result to keep only toContainer descendants
            function (callbackSeries) {
                var x = bulkSimilars;
                var y = orphans
                var str = ""
                for (var fromWord in bulkSimilars) {
                    str += "\t" + fromWord
                    for (var toUri in bulkSimilars[fromWord]) {
                        str += "\t" + bulkSimilars[fromWord][toUri].label + "\t" + bulkSimilars[fromWord][toUri].score
                    }
                    str += "\n"

                }


                callbackSeries()
            },

        ], function (err) {
            if (err) {
                return alert(err)
            }
            // Alignment bot: pass bulkSimilars (the structured data behind str) to the workflow:
            // split exact/non-exact -> validate -> generate equivalentClass -> show non-exacts (to LLM)

            self.orphans=firstPassOrphans
            self.narrowers=narrowers
            var orphanNarrowersMap = buildOrphanNarrowersMap(firstPassOrphans, narrowers)
            self.renderOrphans(firstPassOrphans, fromWordsMap, orphanNarrowersMap)
            Alignment_bot.start(null, {
                bulkSimilars: bulkSimilars,
                fromWordsMap: fromWordsMap,
                source: fromSource,
                targetSource: toSource,
                botDivId: "Alignment_botDiv",
                validationDivId: "Alignment_validationDiv",
                nonExactDivId: "Alignment_nonExactDiv",
                aiDivId: "Alignment_aiDiv",
            })
        })


    }


    // HTML-escaping for label text injected into jstree node markup.
    var htmlAmpRegex = /&/g;
    var htmlLtRegex = /</g;
    var htmlGtRegex = />/g;

    /**
     * Escapes a string for safe insertion into jstree node HTML.
     * @param {*} value - The raw value.
     * @returns {string} The escaped string.
     */
    function escapeHtmlText(value) {
        var safe = String(value == null ? "" : value);
        safe = safe.replace(htmlAmpRegex, "&amp;");
        safe = safe.replace(htmlLtRegex, "&lt;");
        safe = safe.replace(htmlGtRegex, "&gt;");
        return safe;
    }

    /**
     * Builds an orphan node's 2-column HTML: [orphan label] | [narrowers]. When a narrower is chosen,
     * the orphan label is prefixed with a check mark and the chosen narrower is shown in bold.
     * @param {string} orphanLabel - The orphan label.
     * @param {Object} orphanNarrowers - Map { narrowerUri: { label, score } } or null.
     * @param {string} chosenNarrowerUri - The selected narrower URI (or null when none).
     * @returns {string} The node HTML (two aligned columns).
     */
    function buildOrphanNodeText(orphanLabel, orphanNarrowers, chosenNarrowerUri) {
        var labelPrefix = "";
        if (chosenNarrowerUri) {
            labelPrefix = "✓ ";
        }
        var col1 = "<span style='display:inline-block;min-width:250px'>" + labelPrefix + escapeHtmlText(orphanLabel) + "</span>";
        var narrowerUris = [];
        if (orphanNarrowers) {
            narrowerUris = Object.keys(orphanNarrowers);
        }
        var parts = [];
        narrowerUris.forEach(function (narrowerUri) {
            var narrowerLabelHtml = escapeHtmlText(orphanNarrowers[narrowerUri].label);
            if (narrowerUri === chosenNarrowerUri) {
                narrowerLabelHtml = "<b>" + narrowerLabelHtml + "</b>";
            }
            parts.push(narrowerLabelHtml);
        });
        var col2 = "<span style='color:#555'>" + parts.join(", ") + "</span>";
        return col1 + col2;
    }

    /**
     * Collects, for each orphan, its narrowers from BOTH its full-label search and its reduced-form
     * search (first word removed). Long labels rarely match narrowers directly, so the meaningful
     * narrowers come from the reduced word (searched in the 2nd pass).
     * @param {Array<string>} orphans - Orphan source labels (first pass).
     * @param {Object} narrowers - Map { searchedWord: { narrowerUri: { label, score } } }.
     * @returns {Object} Map { orphanLabel: { narrowerUri: { label, score } } }.
     */
    function buildOrphanNarrowersMap(orphans, narrowers) {
        var orphanNarrowersMap = {};
        (orphans || []).forEach(function (orphanLabel) {
            var merged = {};
            if (narrowers && narrowers[orphanLabel]) {
                var directUris = Object.keys(narrowers[orphanLabel]);
                directUris.forEach(function (narrowerUri) {
                    merged[narrowerUri] = narrowers[orphanLabel][narrowerUri];
                });
            }
            var tokens = orphanLabel.split(" ");
            if (tokens.length > 1) {
                var reducedTokens = tokens.slice(1);
                var reducedJoined = reducedTokens.join(" ");
                var reducedWord = reducedJoined.trim();
                if (narrowers && narrowers[reducedWord]) {
                    var reducedUris = Object.keys(narrowers[reducedWord]);
                    reducedUris.forEach(function (narrowerUri) {
                        merged[narrowerUri] = narrowers[reducedWord][narrowerUri];
                    });
                }
            }
            orphanNarrowersMap[orphanLabel] = merged;
        });
        return orphanNarrowersMap;
    }

    /**
     * Renders the orphan source terms (those with no similar found) as a flat, all-checked
     * checkbox jsTree in the Orphans tab, with a second column listing each orphan's narrowers.
     * @function
     * @name renderOrphans
     * @memberof module:AlignmentMakeSimilars
     * @param {Array<string>} orphans - Orphan source labels.
     * @param {Object} fromWordsMap - Map { sourceLabel: sourceUri } (used for the node id/URI when available).
     * @param {Object} narrowers - Map { sourceLabel: { narrowerUri: { label, score } } }.
     * @returns {void}
     */
    self.renderOrphans = function (orphans, fromWordsMap, narrowers) {
        var divId = "Alignment_orphansDiv";
        self._orphanSelections = {};
        self._orphansTreeDivId = divId + "_tree";
        var distinctOrphans = [];
        var seenOrphan = {};
        (orphans || []).forEach(function (orphanLabel) {
            if (!seenOrphan[orphanLabel]) {
                seenOrphan[orphanLabel] = 1;
                distinctOrphans.push(orphanLabel);
            }
        });
        if (distinctOrphans.length === 0) {
            $("#" + divId).html("<i>no orphans</i>");
            return;
        }
        // Action buttons at the top + header line + a dedicated sub-div for the tree.
        var headerHtml = "<div style='margin-bottom:8px;'>";
        headerHtml += "<button id='" + divId + "_createEquivalentClass' style='margin-right:8px;'>create equivalent class</button>";
        headerHtml += "<button id='" + divId + "_createUri'>create uri</button>";
        headerHtml += "</div>";
        headerHtml += "<div style='font-weight:bold;border-bottom:1px solid #999;padding:2px 0 2px 40px;'>";
        headerHtml += "<span style='display:inline-block;min-width:250px'>orphan</span>";
        headerHtml += "<span>narrowers (more specific targets)</span></div>";
        headerHtml += "<div id='" + self._orphansTreeDivId + "'></div>";
        $("#" + divId).html(headerHtml);

        var jstreeData = distinctOrphans.map(function (orphanLabel) {
            var orphanUri = null;
            if (fromWordsMap && fromWordsMap[orphanLabel]) {
                orphanUri = fromWordsMap[orphanLabel];
            }
            var orphanNarrowers = null;
            if (narrowers && narrowers[orphanLabel]) {
                orphanNarrowers = narrowers[orphanLabel];
            }
            return {
                id: orphanUri || orphanLabel,
                parent: "#",
                text: buildOrphanNodeText(orphanLabel, orphanNarrowers, null),
                data: { label: orphanLabel, uri: orphanUri, narrowers: orphanNarrowers },
            };
        });
        // NOT checkable: a plain single-selectable jstree (like the Target source list). Clicking an
        // orphan that has narrowers opens the narrowers dialog; choosing a narrower marks the row with a check.
        var options = {
            selectTreeNodeFn: function (event, obj) {
                self.onOrphanSelected(obj);
            },
        };
        JstreeWidget.loadJsTree(self._orphansTreeDivId, jstreeData, options);

        $("#" + divId + "_createEquivalentClass")
            .off("click")
            .on("click", function () {
                self.createEquivalentClassTriples();
            });
        $("#" + divId + "_createUri")
            .off("click")
            .on("click", function () {
                self.createOrphanUri();
            });
    };

    /**
     * Handles the selection of an orphan node: opens the narrowers dialog when the orphan has narrowers.
     * @function
     * @name onOrphanSelected
     * @memberof module:AlignmentMakeSimilars
     * @param {Object} obj - The jstree select event object (obj.node.data holds label/uri/narrowers).
     * @returns {void}
     */
    self.onOrphanSelected = function (obj) {
        var nodeData = obj.node.data;
        if (!nodeData || !nodeData.narrowers || Object.keys(nodeData.narrowers).length === 0) {
            return;
        }
        self._currentOrphanNodeId = obj.node.id;
        self._currentOrphanUri = nodeData.uri;
        self._currentOrphanLabel = nodeData.label;
        self._currentNarrowers = nodeData.narrowers;
        self.showNarrowersDialog(nodeData.uri, nodeData.label, nodeData.narrowers);
    };

    /**
     * Opens a dialog listing an orphan's narrowers as a checkbox jsTree, with two actions:
     * "create equivalent class" (owl:equivalentClass orphan->narrower into the alignment source) and
     * "create uri" (mint a new owl:Class per checked narrower in ALIGNMENT_TSF).
     * @function
     * @name showNarrowersDialog
     * @memberof module:AlignmentMakeSimilars
     * @param {string} orphanUri - The orphan source URI (subject of owl:equivalentClass; may be null).
     * @param {string} orphanLabel - The orphan label (dialog title).
     * @param {Object} orphanNarrowers - Map { narrowerUri: { label, score } }.
     * @returns {void}
     */
    self.showNarrowersDialog = function (orphanUri, orphanLabel, orphanNarrowers) {
        var dialogDivId = "Alignment_narrowersDialogDiv";
        if ($("#" + dialogDivId).length === 0) {
            $("body").append("<div id='" + dialogDivId + "'></div>");
        }
        var treeDivId = dialogDivId + "_tree";
        self._currentOrphanUri = orphanUri;
        self._currentNarrowers = orphanNarrowers;
        self._narrowersTreeDivId = treeDivId;

        var html = "<div style='margin-bottom:6px;color:#555;'>Click a narrower to select it for \"" + escapeHtmlText(orphanLabel) + "\"</div>";
        html += "<div id='" + treeDivId + "' style='max-height:400px;overflow:auto;'></div>";
        $("#" + dialogDivId).html(html);

        if ($("#" + dialogDivId).hasClass("ui-dialog-content")) {
            $("#" + dialogDivId).dialog("destroy");
        }
        $("#" + dialogDivId).dialog({
            title: "Narrowers — " + orphanLabel,
            width: 600,
            height: 480,
            modal: false,
        });

        var narrowerUris = Object.keys(orphanNarrowers);
        var jstreeData = narrowerUris.map(function (narrowerUri) {
            return {
                id: narrowerUri,
                parent: "#",
                text: escapeHtmlText(orphanNarrowers[narrowerUri].label),
                data: { uri: narrowerUri, label: orphanNarrowers[narrowerUri].label },
            };
        });
        // NOT checkable: single-selectable (like the Target source list). Clicking one narrower selects it.
        var options = {
            selectTreeNodeFn: function (event, obj) {
                self.onNarrowerSelected(obj);
            },
        };
        JstreeWidget.loadJsTree(treeDivId, jstreeData, options);
    };

    /**
     * Handles the selection of a narrower in the dialog: records it as the chosen narrower for the
     * current orphan, marks the orphan row (check mark + bold chosen narrower), and closes the dialog.
     * @function
     * @name onNarrowerSelected
     * @memberof module:AlignmentMakeSimilars
     * @param {Object} obj - The jstree select event object (obj.node.data holds the narrower uri/label).
     * @returns {void}
     */
    self.onNarrowerSelected = function (obj) {
        var narrowerUri = obj.node.data.uri;
        var narrowerLabel = obj.node.data.label;
        self._orphanSelections[self._currentOrphanNodeId] = {
            orphanUri: self._currentOrphanUri,
            orphanLabel: self._currentOrphanLabel,
            narrowerUri: narrowerUri,
            narrowerLabel: narrowerLabel,
        };
        var newText = buildOrphanNodeText(self._currentOrphanLabel, self._currentNarrowers, narrowerUri);
        var orphansTree = $("#" + self._orphansTreeDivId).jstree(true);
        if (orphansTree && orphansTree.rename_node) {
            orphansTree.rename_node(self._currentOrphanNodeId, newText);
        }
        $("#Alignment_narrowersDialogDiv").dialog("close");
    };

    /**
     * Fetches, among candidateUris, those that already exist as a subject in the given source graph.
     * Used to only create what is not yet created (idempotent inserts).
     * @function
     * @name fetchExistingSubjectUris
     * @memberof module:AlignmentMakeSimilars
     * @param {string} source - The source name whose named graph is queried.
     * @param {string[]} candidateUris - The URIs to test for existence.
     * @param {Function} callback - callback(err, existingUris).
     * @returns {void}
     */
    function fetchExistingSubjectUris(source, candidateUris, callback) {
        if (candidateUris.length === 0) {
            return callback(null, []);
        }
        var fromStr = Sparql_common.getFromStr(source, false, true);
        var valuesUris = candidateUris.map(function (uri) {
            return "<" + uri + ">";
        });
        var valuesStr = valuesUris.join(" ");
        var query = "SELECT DISTINCT ?s " + fromStr + " WHERE { VALUES ?s { " + valuesStr + " } ?s ?p ?o }";
        AlignmentUtil.execSparql(source, query, function (err, result) {
            if (err) {
                return callback(err);
            }
            var existingUris = result.results.bindings.map(function (binding) {
                return binding.s.value;
            });
            callback(null, existingUris);
        });
    }

    /**
     * Fetches, among the given (orphanUri, narrowerUri) pairs, those already linked by owl:equivalentClass
     * in the given source graph. Used to only insert new equivalentClass pairs (idempotent).
     * @function
     * @name fetchExistingEquivalentPairs
     * @memberof module:AlignmentMakeSimilars
     * @param {string} source - The alignment source name whose named graph is queried.
     * @param {Object[]} pairs - Array of { orphanUri, narrowerUri }.
     * @param {Function} callback - callback(err, existingPairKeys) where existingPairKeys[orphanUri + "|" + narrowerUri] = true.
     * @returns {void}
     */
    function fetchExistingEquivalentPairs(source, pairs, callback) {
        if (pairs.length === 0) {
            return callback(null, {});
        }
        var fromStr = Sparql_common.getFromStr(source, false, true);
        var valuesLines = pairs.map(function (pair) {
            return "(<" + pair.orphanUri + "> <" + pair.narrowerUri + ">)";
        });
        var valuesStr = valuesLines.join(" ");
        var query = "PREFIX owl: <http://www.w3.org/2002/07/owl#> SELECT ?s ?o " + fromStr +
            " WHERE { VALUES (?s ?o) { " + valuesStr + " } ?s owl:equivalentClass ?o }";
        AlignmentUtil.execSparql(source, query, function (err, result) {
            if (err) {
                return callback(err);
            }
            var existingPairKeys = {};
            result.results.bindings.forEach(function (binding) {
                var pairKey = binding.s.value + "|" + binding.o.value;
                existingPairKeys[pairKey] = true;
            });
            callback(null, existingPairKeys);
        });
    }

    /**
     * "create equivalent class": inserts <orphan> owl:equivalentClass <chosenNarrower> for every orphan
     * that has a chosen narrower, into the alignment source (ALIGNMENT_ECLASS / ALIGNMENT_UNSPSC per target).
     * Idempotent: only pairs not already present in the alignment graph are inserted. Orphans without a
     * URI are skipped (cannot be a subject).
     * @function
     * @name createEquivalentClassTriples
     * @memberof module:AlignmentMakeSimilars
     * @returns {void}
     */
    self.createEquivalentClassTriples = function () {
        var nodeIds = Object.keys(self._orphanSelections || {});
        if (nodeIds.length === 0) {
            return alert("no orphan has a chosen narrower (click an orphan, then a narrower)");
        }
        var alignmentSource = ALIGNMENT_SOURCE_BY_TARGET[self.currentTargetSource];
        if (!alignmentSource || !Config.sources[alignmentSource]) {
            return alert("alignment source for target '" + self.currentTargetSource + "' is not configured on this instance");
        }
        var candidatePairs = [];
        var missingUriCount = 0;
        nodeIds.forEach(function (nodeId) {
            var selection = self._orphanSelections[nodeId];
            if (!selection.orphanUri) {
                missingUriCount += 1;
                return;
            }
            candidatePairs.push({ orphanUri: selection.orphanUri, narrowerUri: selection.narrowerUri });
        });
        if (candidatePairs.length === 0) {
            return alert("no orphan with a URI to link (" + missingUriCount + " skipped)");
        }
        fetchExistingEquivalentPairs(alignmentSource, candidatePairs, function (err, existingPairKeys) {
            if (err) {
                return alert("Error checking existing equivalentClass: " + (err.message || err));
            }
            var triples = [];
            var alreadyExistCount = 0;
            candidatePairs.forEach(function (pair) {
                var pairKey = pair.orphanUri + "|" + pair.narrowerUri;
                if (existingPairKeys[pairKey]) {
                    alreadyExistCount += 1;
                    return;
                }
                triples.push({ subject: pair.orphanUri, predicate: OWL_EQUIVALENT_CLASS, object: pair.narrowerUri });
            });
            if (triples.length === 0) {
                return UI.message("nothing to add: all selected equivalent classes already exist in " + alignmentSource, true);
            }
            Sparql_generic.insertTriples(alignmentSource, triples, {}, function (err) {
                if (err) {
                    return alert("Error inserting equivalentClass: " + (err.message || err));
                }
                var message = triples.length + " equivalent classes created in " + alignmentSource;
                if (alreadyExistCount > 0) {
                    message += " (" + alreadyExistCount + " already existed, skipped)";
                }
                if (missingUriCount > 0) {
                    message += " (" + missingUriCount + " skipped, no orphan URI)";
                }
                UI.message(message, true);
            });
        });
    };

    /**
     * "create uri": for each SELECTED orphan, mints a new owl:Class in ALIGNMENT_TSF using the orphan's
     * own label (URI = ALIGNMENT_TSF graph + label slug, via common.getURI — same as "add resource / class"),
     * plus an rdfs:label triple and an rdfs:subClassOf owl:Thing triple. Idempotent: only orphans whose URI
     * does not yet exist are created. The newly-created URIs are then indexed into ElasticSearch.
     * @function
     * @name createOrphanUri
     * @memberof module:AlignmentMakeSimilars
     * @returns {void}
     */
    self.createOrphanUri = function () {
        var orphansTree = $("#" + self._orphansTreeDivId).jstree(true);
        var selectedIds = [];
        if (orphansTree && orphansTree.get_selected) {
            selectedIds = orphansTree.get_selected();
        }
        if (selectedIds.length === 0) {
            return alert("no orphan selected (click an orphan first)");
        }
        if (!Config.sources[ALIGNMENT_TSF_SOURCE]) {
            return alert("source '" + ALIGNMENT_TSF_SOURCE + "' is not configured on this instance");
        }
        var candidates = selectedIds.map(function (nodeId) {
            var node = orphansTree.get_node(nodeId);
            var orphanLabel = node.data.label;
            var newUri = common.getURI(orphanLabel, ALIGNMENT_TSF_SOURCE, "fromLabel");
            return { uri: newUri, label: orphanLabel };
        });
        var candidateUris = candidates.map(function (candidate) {
            return candidate.uri;
        });
        fetchExistingSubjectUris(ALIGNMENT_TSF_SOURCE, candidateUris, function (err, existingUris) {
            if (err) {
                return alert("Error checking existing URIs: " + (err.message || err));
            }
            var triples = [];
            var createdUris = [];
            var alreadyExistCount = 0;
            candidates.forEach(function (candidate) {
                if (existingUris.indexOf(candidate.uri) !== -1) {
                    alreadyExistCount += 1;
                    return;
                }
                triples.push({ subject: candidate.uri, predicate: "rdf:type", object: "owl:Class" });
                triples.push({ subject: candidate.uri, predicate: "rdfs:label", object: Sparql_common.formatStringForTriple(candidate.label) });
                triples.push({ subject: candidate.uri, predicate: "rdfs:subClassOf", object: "owl:Thing" });
                createdUris.push(candidate.uri);
            });
            if (triples.length === 0) {
                return UI.message("nothing to add: selected orphan(s) already created in " + ALIGNMENT_TSF_SOURCE, true);
            }
            Sparql_generic.insertTriples(ALIGNMENT_TSF_SOURCE, triples, {}, function (err) {
                if (err) {
                    return alert("Error creating TSF class: " + (err.message || err));
                }
                SearchUtil.generateElasticIndex(ALIGNMENT_TSF_SOURCE, { ids: createdUris }, function (err) {
                    if (err) {
                        return alert("Classes created but indexing failed: " + (err.message || err));
                    }
                    var message = createdUris.length + " class(es) created and indexed in " + ALIGNMENT_TSF_SOURCE;
                    if (alreadyExistCount > 0) {
                        message += " (" + alreadyExistCount + " already existed, skipped)";
                    }
                    UI.message(message, true);
                });
            });
        });
    };

    self.test = function () {

        self.currentSource = "CFIHOS-IOF"
        self.currentTargetSource = "UNSPSC"
        self.currentSourceContainerId = "https://jip36-cfihos/rdl-iof/equip-CFIHOS-30000311"
        self.currentTargetContainerId = "http://souslesens/ontology/unspsc/20000000"


        // Disabled: this source does not exist in this instance (was causing the crash)
        // self.currentSource = "ISO-14224-IOF-RDL"
        // self.currentSourceContainerId = "http://datalenergies.total.com/resource/tsf/iso-14224-iof-rdl/Equipments"
        // self.currentTargetSource = "CFIHOS-IOF"

        self.listSimilars()

    }


    return self;


})
()

export default AlignmentMakeSimilars
window.AlignmentMakeSimilar = AlignmentMakeSimilars