/**
 * Generated by PluginGenerator from webgme on Tue Nov 04 2014 13:59:08 GMT-0600 (Central Standard Time).
 */

define( [ 'plugin/PluginConfig',
    'plugin/PluginBase',
    'ejs',
    'plugin/GenerateDashboard/GenerateDashboard/Templates/Templates',
    'jszip',
    'plugin/GenerateDashboard/GenerateDashboard/meta',
    'plugin/GenerateDashboard/GenerateDashboard/dashboardTypes',
    'plugin/AdmExporter/AdmExporter/AdmExporter',
    'xmljsonconverter'
], function ( PluginConfig, PluginBase, ejs, TEMPLATES, JSZip, MetaTypes, DashboardTypes, AdmExporter, Converter ) {
    'use strict';

    /**
     * Initializes a new instance of GenerateDashboard.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin GenerateDashboard.
     * @constructor
     */
    var GenerateDashboard = function () {
        // Call base class' constructor.
        PluginBase.call( this );

        this.metaTypes = MetaTypes;
        this.admExporter = null;
        this.designSpaceNode = null;
        this.json2xml = null;
        this.testResultObjectIDs = [
            "/243203739/1914067160/1594627875/738670268/1604609344/1138983316",
            "/243203739/1914067160/1594627875/738670268/1604609344/638117119",
            "/243203739/1914067160/1594627875/738670268/14675327/721601556",
            "/243203739/1914067160/1594627875/738670268/14675327/669656366"
        ];

        this.dashboardObject = {
            dashboardHashLF: "ada66617178a84bc9d9b7d9a2510019e1e6ade06",
            dashboardHashCRLF: "ed3320752e9598774183d92a0600b9c53d85d3c2",
            designs: {},
            designSpace: {
                name: null,
                data: null
            },
            requirements: "dummy requirements blob hash",
            results: {
                resultsMetaresultsJson: null,
                results: {}
            },
            testBenches: {},
            manifestProjectJson: null
        };
    };

    // Prototypal inheritance from PluginBase.
    GenerateDashboard.prototype = Object.create( PluginBase.prototype );
    GenerateDashboard.prototype.constructor = GenerateDashboard;

    /**
     * Gets the name of the GenerateDashboard.
     * @returns {string} The name of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getName = function () {
        return "Generate Dashboard";
    };

    /**
     * Gets the semantic version (semver.org) of the GenerateDashboard.
     * @returns {string} The version of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getVersion = function () {
        return "0.1.0";
    };

    /**
     * Gets the description of the GenerateDashboard.
     * @returns {string} The description of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getDescription = function () {
        return "Takes a list of Result Object IDs, and create a Dashboard package for visualization";
    };

    /**
     * Gets the configuration structure for the TestBenchRunner.
     * The ConfigurationStructure defines the configuration for the plugin
     * and will be used to populate the GUI when invoking the plugin from webGME.
     * @returns {object} The version of the plugin.
     * @public
     */
    GenerateDashboard.prototype.getConfigStructure = function () {
        return [ {
            'name': 'resultIDs',
            'displayName': 'Result Object IDs',
            'description': 'IDs of Result objects to add to the Generated Dashboard, separated by semicolons.',
            'value': '',
            'valueType': 'string',
            'readOnly': false
        } ];
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    GenerateDashboard.prototype.main = function ( callback ) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            //config = self.getCurrentConfig(),
            workSpaceName,
            workSpaceNode,
            designName = self.core.getAttribute( self.activeNode, 'name' ),
            designObjectID = self.core.getPath( self.activeNode ),
            designID = self.core.getGuid( self.activeNode ),
            currentConfig = self.getCurrentConfig(),
            resultObjectIDs = [];

        if ( self.isMetaTypeOf( self.activeNode, self.META.Container ) === false ) {
            self.createMessage( null, 'This plugin must be called from a Container.', 'error' );
            callback( null, self.result );
            return;
        }

        if ( currentConfig.resultIDs ) {
            resultObjectIDs = currentConfig.resultIDs.split( ';' );
        }

        self.updateMETA( self.metaTypes );
        self.json2xml = new Converter.Json2xml();
        self.designSpaceNode = self.activeNode;

        // Run AdmExporter to get design_space/%ThisDesignName%.adm
        self.initializeAdmExporter( designObjectID );

        // self.activeNode needs to be the design, 2nd argument is bool: include/return acm files
        var exploreDesignCallbackFunction = function ( err ) {
            if ( err ) {
                self.logger.error( 'AdmExporter.exploreDesign failed with error: ' + err );
                self.logger.error( err );
                self.result.setSuccess( false );
                return callback( err, self.result );
            }

            // get the DesignSpace adm
            self.dashboardObject.designSpace.name = designName;
            self.dashboardObject.designSpace.data = {
                Design: self.admExporter.admData
            };

            // Create the manifest.project.json
            workSpaceNode = self.getWorkspaceNode( self.designSpaceNode );
            workSpaceName = self.core.getAttribute( workSpaceNode, 'name' );

            self.dashboardObject.manifestProjectJson = new DashboardTypes.manifestProjectJson( workSpaceName );

            // Create the results.metaresults.json
            self.dashboardObject.results.resultsMetaresultsJson = new DashboardTypes.resultsMetaresultsJson();

            // Create requirements
            self.dashboardObject.requirements = new DashboardTypes.requirementsJson();

            var getResultsCallbackFunction = function ( err ) {
                if ( err ) {
                    self.logger.error( err );
                    self.result.setSuccess( false );
                    return callback( err, self.result );
                }

                self.createDashboardArtifact( function ( err, dashboardArtifactHash ) {
                    if ( err ) {
                        self.logger.error( err );
                        self.result.setSuccess( false );
                        return callback( err, self.result );
                    }

                    self.result.addArtifact( dashboardArtifactHash );
                    self.result.setSuccess( true );
                    self.save( 'added obj', function ( err ) {
                        callback( null, self.result );
                    } );
                } );
            };

            self.getResults( designName, designID, resultObjectIDs, getResultsCallbackFunction );

        };

        self.admExporter.exploreDesign( self.designSpaceNode, false, exploreDesignCallbackFunction );
    };

    GenerateDashboard.prototype.createDashboardArtifact = function ( callback ) {
        var self = this,
            filesToAdd = {},
            dashboardArtifact = self.blobClient.createArtifact( 'dashboard' ),
            filePath,
            key;

        // designs (configurations)
        for ( key in self.dashboardObject.designs ) {
            if ( self.dashboardObject.designs.hasOwnProperty( key ) ) {
                filePath = "designs/" + key + ".adm";
                self.dashboardObject.manifestProjectJson.Project.Configurations.push( "./" + filePath );
                filesToAdd[ filePath ] = self.json2xml.convertToString( self.dashboardObject.designs[ key ] );
            }
        }

        // design-space
        filePath = "design-space/" + self.dashboardObject.designSpace.name + ".adm";
        self.dashboardObject.manifestProjectJson.Project.DesignSpaceModels.push( "./" + filePath );
        filesToAdd[ filePath ] = self.json2xml.convertToString( self.dashboardObject.designSpace.data );

        // requirements
        filePath = "requirements/requirements.json";
        filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.requirements, null, 4 );

        // results.metaresults.json
        filePath = "results/results.metaresults.json";
        filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.results.resultsMetaresultsJson, null, 4 );

        // results
        for ( key in self.dashboardObject.results.results ) {
            if ( self.dashboardObject.results.results.hasOwnProperty( key ) ) {
                filePath = "results/" + key + "/testbench_manifest.json";
                filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.results.results[ key ], null, 4 );
            }
        }

        // test-benches
        for ( key in self.dashboardObject.testBenches ) {
            if ( self.dashboardObject.testBenches.hasOwnProperty( key ) ) {
                filePath = "test-benches/" + key;
                self.dashboardObject.manifestProjectJson.Project.TestBenches.push( "./" + filePath );
                filesToAdd[ filePath ] = JSON.stringify( self.dashboardObject.testBenches[ key ], null, 4 );
            }
        }

        filesToAdd[ "manifest.project.json" ] = JSON.stringify( self.dashboardObject.manifestProjectJson, null, 4 );

        filesToAdd[ "launch_SimpleHTTPServer.cmd" ] = ejs.render( TEMPLATES[ 'launch_SimpleHTTPServer.cmd.ejs' ] );

        dashboardArtifact.addFiles( filesToAdd, function ( err, fileHashes ) {
            var addDashboardFiles;
            if ( err ) {
                callback( err, null );
            }

            // add the dashboard package to the artifact
            addDashboardFiles = function ( dashboardMetadata ) {
                var path,
                    hashToAdd,
                    mdContent = dashboardMetadata.content,
                    hashCounter = Object.keys( dashboardMetadata.content )
                        .length,
                    errors = '',
                    addDashboardHashCounterCallback = function ( err, addedHash ) {
                        if ( err ) {
                            errors += err;
                        }

                        self.logger.info( "Added hash to artifact: " + addedHash );

                        hashCounter -= 1;
                        if ( hashCounter === 0 ) {
                            if ( errors ) {
                                callback( errors, null );
                            }

                            dashboardArtifact.save( callback );
                        }
                    };

                for ( path in mdContent ) {
                    if ( mdContent.hasOwnProperty( path ) ) {
                        hashToAdd = mdContent[ path ].content;

                        dashboardArtifact.addObjectHash( path, hashToAdd, addDashboardHashCounterCallback );
                    }
                }
            };

            self.blobClient.getMetadata( self.dashboardObject.dashboardHashLF, function ( err,
                dashboardMetadata ) {
                if ( err ) {
                    self.logger.info( 'Could not find hash for dashboard LF ' + self.dashboardObject.dashboardHashLF );
                    self.blobClient.getMetadata( self.dashboardObject.dashboardHashCRLF, function ( err,
                        dashboardMetadata ) {
                        if ( err ) {
                            self.logger.info( 'Could not find hash for dashboard CRLF ' +
                                self.dashboardObject.dashboardHashCRLF );
                            self.createMessage( self.designSpaceNode,
                                "Could not add dashboard files from blob. Add them manually" );
                            dashboardArtifact.save( callback );
                        } else {
                            addDashboardFiles( dashboardMetadata );
                        }
                    } );
                } else {
                    addDashboardFiles( dashboardMetadata );
                }
            } );
        } );
    };

    GenerateDashboard.prototype.getResults = function ( designSpaceName, designSpaceID, resultObjectIDs, callback ) {
        var self = this,
            resultCounter = resultObjectIDs.length,
            cumulativeError = "",
            decrementCounterCallback,
            loadByPathCallbackFunction,
            loadDesertConfigChildrenCallback,
            loadDesertConfigSetChildrenCallback,
            loadDesignSpaceChildrenCallback,
            i,
            ithChild,
            iResult,
            iConfig,
            finished = false;

        decrementCounterCallback = function ( err ) {
            if ( err ) {
                cumulativeError += err;
            }

            resultCounter -= 1;

            if ( resultCounter === 0 ) {
                return callback( cumulativeError );
            }
        };

        if ( resultCounter !== 0 ) {
            // Iterate over the user-defined list of Result IDs (async with counter)
            loadByPathCallbackFunction = function ( err, loadedNode ) {
                if ( err ) {
                    return decrementCounterCallback( err );
                }

                self.readAndModifyResultData( loadedNode, designSpaceName, designSpaceID, decrementCounterCallback );
            };

            for ( i = 0; i < resultObjectIDs.length; i++ ) {

                self.core.loadByPath( self.rootNode, resultObjectIDs[ i ], loadByPathCallbackFunction );
            }

        } else {

            loadDesertConfigChildrenCallback = function ( err, resultNodes ) {
                if ( err ) {
                    return callback( err );
                }

                if ( resultNodes.length > 0 ) {
                    // only want to get results from one configuration set ("firstOrDefault")
                    finished = true;
                }

                resultCounter += resultNodes.length;

                for ( iResult = 0; iResult < resultNodes.length; iResult++ ) {
                    if ( self.isMetaTypeOf( resultNodes[ iResult ], self.metaTypes.Result ) ) {
                        self.readAndModifyResultData( resultNodes[ iResult ], designSpaceName, designSpaceID,
                            decrementCounterCallback );
                    }
                }
            };

            loadDesertConfigSetChildrenCallback = function ( err, desertConfigs ) {
                if ( err ) {
                    return callback( err );
                }

                for ( iConfig = 0; iConfig < desertConfigs.length; iConfig++ ) {
                    if ( self.isMetaTypeOf( desertConfigs[ iConfig ], self.metaTypes.DesertConfiguration ) ) {
                        self.core.loadChildren( desertConfigs[ iConfig ], loadDesertConfigChildrenCallback );
                    }
                }
            };

            loadDesignSpaceChildrenCallback = function ( err, designSpaceChildren ) {
                if ( err ) {
                    return callback( err );
                }

                for ( i = 0; i < designSpaceChildren.length; i++ ) {
                    if ( finished ) {
                        // only want to get results from one configuration set ("firstOrDefault")
                        continue;
                    }

                    ithChild = designSpaceChildren[ i ];
                    if ( self.isMetaTypeOf( ithChild, self.metaTypes.DesertConfigurationSet ) ) {
                        self.createMessage( ithChild, "Created dashboard for DesertConfigurationSet.", 'info' );
                        self.core.loadChildren( ithChild, loadDesertConfigSetChildrenCallback );
                    }
                }
            };

            self.core.loadChildren( self.designSpaceNode, loadDesignSpaceChildrenCallback );
        }
    };

    GenerateDashboard.prototype.readAndModifyResultData = function ( resultNode, designSpaceName, designSpaceID,
        callback ) {
        var self = this,
            tbManifestHash = self.core.getAttribute( resultNode, 'Artifacts' ),
            cfgAdmHash = self.core.getAttribute( resultNode, 'CfgAdm' ),
            configNode = self.core.getParent( resultNode ), // the parent config object
            configNodeName = self.core.getAttribute( configNode, 'name' ), // the webgme name for the config
            configName = configNodeName.replace( ". ", "_" )
                .replace( ": ", "_" ), // the 'safer' name
            configNodeGuid = self.core.getGuid( configNode ); // the DesignID for this result's config

        self.getTestbenchManifest( tbManifestHash, function ( err, tbManifestJson ) {
            if ( err ) {
                return callback( err );
            }

            // Append the config name to the design space name (e.g., Wheel + _ + Conf_no_1)
            configName = designSpaceName + '_' + configName;

            self.processTestbenchManifest( tbManifestJson, designSpaceName, configName, configNodeGuid );

            // Check if there is already an adm for this config (multiple results per config)
            if ( self.dashboardObject.designs.hasOwnProperty( configName ) ) {
                callback( null );
            } else {
                self.getCfgAdm( cfgAdmHash, function ( err, admJson ) {
                    if ( err ) {
                        return callback( err );
                    }

                    // 'rename' it (designSpaceName), and set the ID (designSpaceID)
                    admJson.Design[ '@DesignID' ] = configNodeGuid;
                    admJson.Design[ '@Name' ] = configName;
                    admJson.Design.RootContainer[ '@Name' ] = configName;
                    admJson.Design[ '@DesignSpaceSrcID' ] = '{' + designSpaceID + '}';

                    self.dashboardObject.designs[ configName ] = admJson;

                    callback( null );
                } );
            }
        } );
    };

    GenerateDashboard.prototype.processTestbenchManifest = function ( tbManifestJson, designSpaceName, configName,
        configNodeGuid ) {
        var self = this,
            resultDirName,
            resultMetaresult,
            testBenchName = tbManifestJson.TestBench,
            testbenchJson = new DashboardTypes.testbenchJson( testBenchName ),
            tbParam,
            tbMetric,
            i;

        // modify the testbench_manifest.json
        tbManifestJson.DesignName = configName;
        tbManifestJson.DesignID = '{' + configNodeGuid + '}';

        // add to the results.metaresults.json object
        // generate a semi-random result directory name
        resultDirName = Math.random()
            .toString( 36 )
            .substring( 8 );
        resultDirName += Object.keys( self.dashboardObject.results.results )
            .length;

        resultMetaresult =
            new DashboardTypes.resultMetaresult( configNodeGuid, tbManifestJson.TestBench, tbManifestJson.Created,
                resultDirName );

        self.dashboardObject.results.results[ resultDirName ] = tbManifestJson;
        self.dashboardObject.results.resultsMetaresultsJson.Results.push( resultMetaresult );

        // Generate a testbench description
        // Parameters
        for ( i = 0; i < tbManifestJson.Parameters.length; i++ ) {
            tbParam = tbManifestJson.Parameters[ i ];
            testbenchJson.Parameters.push(
                new DashboardTypes.testbenchParameter( tbParam.Name, tbParam.Value, tbParam.Unit, i + 1 ) );
        }
        // Metrics
        for ( i = 0; i < tbManifestJson.Metrics.length; i++ ) {
            tbMetric = tbManifestJson.Metrics[ i ];
            testbenchJson.Metrics.push(
                new DashboardTypes.testbenchMetric( tbMetric.Name, tbMetric.Value, tbMetric.Unit, i + 1 ) );
        }

        testBenchName += ".testbench.json";
        self.dashboardObject.testBenches[ testBenchName ] = testbenchJson;
    };

    GenerateDashboard.prototype.getTestbenchManifest = function ( tbManifestHash, callback ) {
        var self = this,
            errMsg;

        self.blobClient.getObject( tbManifestHash, function ( err, tbManifestContent ) {
            if ( err ) {
                errMsg = "Could not get testbench_manifest from " + tbManifestHash + ": " + err;
                return callback( errMsg, null );
            }

            var tbManifestZip = new JSZip( tbManifestContent ),
                tbManifestObject = tbManifestZip.file( /testbench_manifest.json/ ),
                tbManifestJson;

            if ( tbManifestObject === null ) {
                errMsg = "Could not get testbench_manifest from " + tbManifestHash + ": " + err;
                self.logger.error( errMsg );
                return callback( errMsg, null );
            }

            // regular expression will return an array, so we need to get the first item
            tbManifestJson = JSON.parse( tbManifestObject[ 0 ].asText() );

            callback( null, tbManifestJson );
        } );
    };

    GenerateDashboard.prototype.getCfgAdm = function ( cfgAdmHash, callback ) {
        var self = this,
            errMsg;

        self.blobClient.getObject( cfgAdmHash, function ( err, cfgAdmObjectContent ) {
            if ( err ) {
                errMsg = "Could not get adm from xml " + cfgAdmHash + ": " + err;
                return callback( errMsg, null );
            }

            var zip = new JSZip( cfgAdmObjectContent ),
                cfgAdmXml = zip.file( /\.adm/ ), // regular expression will return an array
                cfgAdmJson;

            if ( cfgAdmXml === null ) {
                errMsg = "Could not get adm from xml " + cfgAdmHash + ": " + err;
                self.logger.error( errMsg );
                return callback( errMsg, null );
            }

            // need to convert to json for editing
            cfgAdmJson = self.convertXml2Json( cfgAdmXml[ 0 ].asArrayBuffer() );

            if ( cfgAdmJson instanceof Error ) {
                errMsg = 'Given adm not valid xml: ' + cfgAdmJson.message;
                return callback( errMsg, null );
            }

            callback( null, cfgAdmJson );
        } );
    };

    GenerateDashboard.prototype.convertXml2Json = function ( modelDescriptionXml ) {
        var self = this,
            arrayElementsInXml = {
                Design: false,
                RootContainer: false,
                Value: false,
                Container: true,
                Connector: true,
                Property: true,
                Formula: true,
                Operand: true,
                ValueFlowMux: true,
                ComponentInstance: true,
                PrimitivePropertyInstance: true,
                ConnectorInstance: true,
                PortInstance: true,
                Role: true,
                Port: true
            },
            converter = new Converter.Xml2json( {
                skipWSText: true,
                arrayElements: arrayElementsInXml
            } );

        return converter.convertFromBuffer( modelDescriptionXml );
    };

    GenerateDashboard.prototype.initializeAdmExporter = function ( designPath ) {
        var self = this;
        if ( self.admExporter === null ) {
            self.admExporter = new AdmExporter();
            self.admExporter.meta = self.metaTypes; // meta is defined here (points to adjacent meta.js file)
            self.admExporter.META = self.META; // META is from PluginBase
            self.admExporter.core = self.core;
            self.admExporter.logger = self.logger;
            self.admExporter.result = self.result;
            self.admExporter.rootPath = designPath || null;
            self.admExporter.rootNode = self.rootNode;
            self.logger.info( 'AdmExporter had not been initialized - created a new instance.' );
        } else {
            self.admExporter.acmFiles = {};
            self.admExporter.gatheredAcms = {};
            self.admExporter.rootPath = designPath || null;
            self.admExporter.includeAcms = true;
            self.logger.info(
                'AdmExporter had already been initialized - reset acmFiles, gatheredAcms and rootPath.' );
        }
    };

    GenerateDashboard.prototype.getWorkspaceNode = function ( node ) {
        var self = this;
        while ( node ) {
            if ( self.isMetaTypeOf( node, self.metaTypes.WorkSpace ) ) {
                return node;
            }
            node = self.core.getParent( node );
        }
        self.logger.error( 'Could not find WorkSpace!!' );
    };

    return GenerateDashboard;
} );