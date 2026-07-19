import Alignment_bot from "./alignment_bot.js";

var AlignmentMakeSimilars = (function () {

    var self = {}
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

                var options = {
                    jstreeOptions: {selectTreeNodeFn: AlignmentMakeSimilar.selectSourceTreeNodeFn},
                    contextMenu: AlignmentMakeSimilar.getSourceContextJstreeMenu()
                }
                //   $("#mainDialogDiv").addClass("zIndexTop-10");
                Containers_tree.search(self.sourceContainerJstreeDivId, self.currentSource, options);
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

        var fromSource = self.currentSource;
        var toSource = self.currentTargetSource;
        var fromcontainer = self.currentSourceContainerId;


        if (!fromcontainer) {
            return alert("no source container selected")
        }
        if (!toSource) {
            return alert("no target source selected (check UNSPSC or ECLASS)")
        }


        var fromWordsMap = {}
        var bulkSimilars = {}
        var orphans = []


        function searchSimilars(toSource, wordsAll, callback) {
            var similars = {}
            var orphans = []
            var slices = common.array.slice(wordsAll, 100)

            async.eachSeries(slices, function (words, callbackEach) {


                var options ={} //{classFilterXX: "http://purl.obolibrary.org/obo/BFO_0000001"}
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
                            }

                        })
                        if (!similars[fromWord]) {
                            orphans.push(fromWord)
                        }
                    })

                    callbackEach()
                })
            }, function (err) {

                callback(null, {similars, orphans});

            })
        }


        async.series([

            //select from alldescendants
            function (callbackSeries) {
                Containers_query.getContainerDescendants(self.currentSource, fromcontainer, {leaves: true}, function (err, result) {
                    if (err) {
                        return callbackSeries(err);
                    }
                    result.results.bindings.forEach(function (item) {
                        if( item.memberLabel )
                        fromWordsMap[item.memberLabel.value] = item.member.value
                    })

                    callbackSeries();

                })
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
                    orphans=result.orphans
                    for (var reducedWord in result.similars) {
                        var initialWord = reducedOrphansMap[reducedWord]
                        var similar = result.similars[reducedWord]
                        if (initialWord) {

                            bulkSimilars[initialWord] = similar

                        }else{

                        }
                    }

                    callbackSeries(err)
                })


            },
            //filter result to keep only toContainer descendants
            function (callbackSeries) {
            var x=bulkSimilars;
            var y =orphans
                var str=""
                for (var fromWord in bulkSimilars){
                    str+="\t"+fromWord
                    for (var toUri in bulkSimilars[fromWord]) {
                      str+="\t"+bulkSimilars[fromWord][toUri].label+"\t"+bulkSimilars[fromWord][toUri].score
                    }
                    str+="\n"

                    }



                callbackSeries()
            },

        ], function (err) {
            if (err) {
                return alert(err)
            }
            // Alignment bot: pass bulkSimilars (the structured data behind str) to the workflow:
            // split exact/non-exact -> validate -> generate equivalentClass -> show non-exacts (to LLM)
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