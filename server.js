var util = require('util'),
    sys = require("sys"),
    fs = require('fs'),
    http = require('http'),
    net = require('net'),
   // ws = require('./ws/lib/ws/server');
	ws = require("./ws");
	
websocketOutputs = [];

_DEBUG = false;
_VERBOSE = false;
_CONFIGPATH = "config.json";
process.argv.forEach(function (val, index, array) {
    if (val == "--debug") _DEBUG = true;
    if (val == "--verbose") _VERBOSE = true;
    if (val == "--config") {
	if(process.argv.length > index && process.argv[index+1] != "--debug" && process.argv[index+1] != "--verbose")
		_CONFIGPATH = process.argv[index+1];
	}
});

fs.readFile(_CONFIGPATH, function (err, configdata) { //read the config file and then open the servers
    if (err) throw err;
    config = JSON.parse(configdata);
 	if (_VERBOSE || _DEBUG) console.log("read config file, " + config.projects.length + " projects defined"); 

    //open the MQTT listening subprocess
    //spawn = require('child_process').spawn, mqtt = spawn('mosquitto_sub-0.10.2.exe', ['-h', config.config.MQTTBrokerAddress, '-p', config.config.MQTTBrokerPort, '-t', config.config.projectname + '/#', '-v']);
	for(projectID in config.projects){
		project = config.projects[projectID];
		spawn = require('child_process').spawn, mqtt = spawn('mosquitto_sub', ['-h', config.MQTTBrokerAddress, '-p', config.MQTTBrokerPort, '-t', project.name + '/#', '-v']);
	    mqtt.stdout.setEncoding('utf8');  //could be reimplemented with inline MQTT instead of subprocess
	    if (_VERBOSE || _DEBUG) console.log('Spawned mosquitto_sub (ProjectName' + project.name + ', pid: ' + mqtt.pid + ')');
	    mqtt.stdout.on('data', function (data) { //could be reimplemented with inline MQTT instead of subprocess (currently spawning a process for each project)
	        var address = data.substring(0, data.indexOf(' '));
	        var payload = data.substring(data.indexOf(' ') + 1);
			fs.readFile(project.configPath, function (err, projectConfigData) { //read the config file and then open the servers
				projectConfig = JSON.parse(projectConfigData);
				perform_action(address, payload, "MQTT", "", config, projectConfig, project.name, _DEBUG);
			});
	    });	
	}
	
    http.createServer(function (req, res) {
        var POSTDATA = "";
        req.addListener('data', function (DATA) {
            POSTDATA += DATA;
        }).addListener('end', function () {
            if (req.method == "GET") {
                if (req.url.indexOf("?") == -1) {
                    var address = req.url;
                    var payload = "";
                } else {
                    var address = req.url.substring(0, req.url.indexOf("?"));
                    var payload = req.url.substring(req.url.indexOf("?") + 1);
                }
            } else if (req.method == "POST") {
                var payload = POSTDATA;
                var address = req.url;
            }
            if (_DEBUG) console.log("received HTTP on: " + address + " data: " + payload);
			project = project_match(address, "HTTP", config);
			if(project == null){
				if(_DEBUG) console.log('No project defined for address: ' + address);
	            res.writeHead(404, {'Content-Type': 'text/plain'});
	            res.end('Command Received - No Project defined for that address\n');				
			} else {
				fs.readFile(project.configPath, function (err, projectConfigData) { //read the config file and then open the servers
					projectConfig = JSON.parse(projectConfigData);
					perform_action(address, payload, "HTTP", req.method, config, projectConfig, project.name, _DEBUG);
		            res.writeHead(200, {'Content-Type': 'text/plain'});
		            res.end('Command Received - action performed\n');
				});			
			}

        });
    }).listen(config.HTTPBindPort, config.HTTPBindIP);
    if (_DEBUG || _VERBOSE) console.log('HTTP Server bound at http://' + config.HTTPBindIP + ':' + config.HTTPBindPort);
	
	ws.createServer(function(websocket) {
		websocket.addListener("connect", function (address) {
			this.address = address;
			project = project_match(address, "WEBSOCKET", config); //is a project defined that that address?
			if(project == null){
				if(_DEBUG) console.log('No project defined for address: ' + address);
	            websocket.write("No project defined at that address");
	            websocket.end();				
			} else {
				fs.readFile(project.configPath, function (err, projectConfigData) { //read the config file and then open the servers
					projectConfig = JSON.parse(projectConfigData);
					outputAndParameters = matched_output(projectConfig.outputs, address, "WEBSOCKET", project.name,  _DEBUG);
					inputAndParameters = matched_input(projectConfig.inputs, address, "WEBSOCKET", "", project.name,  _DEBUG);
					if(_DEBUG) console.log("inputParam:");
					if(_DEBUG) console.log(inputAndParameters);
					if(_DEBUG) console.log("outputParam:");
					if(_DEBUG) console.log(outputAndParameters);

					if(outputAndParameters == undefined && inputAndParameters == undefined){
			            websocket.write("No input or output defined at that address.");
			            websocket.end();			
					} else {
						if(inputAndParameters != undefined) {
							websocket.addListener("data", function (payload) { //remove socket from array when client disconnects
									if(_DEBUG) console.log("Performing websocket input: " + inputAndParameters.input.id + 'passing action address ' + project.name + "/" + inputAndParameters.address);
									if(_DEBUG) console.log(this);
									//issue here - new connected clients are overwriting the address parameter.
									perform_action(this.address, payload, "WEBSOCKET", "", config, projectConfig, project.name, _DEBUG);
				            });
						}
						if(outputAndParameters != undefined) {
						    if (websocketOutputs[outputAndParameters.address] == undefined) websocketOutputs[outputAndParameters.address] = [];
				            websocketOutputs[outputAndParameters.address].push(websocket);        
							websocket.addListener("close", function () { //remove socket from array when client disconnects
				                if (_DEBUG) console.log("closing websocket: " + this.id);
				                websocketOutputs.forEach(function (websocketClientsOutput) {
									websocketClientsOutput.forEach(function (websocket){
										if(this.id == websocket.id) delete(websocket);
									});
								});
				            });
						}					
					}
				});				
			}
		});
	}).listen(config.WebSocketPort, config.WEBSocketIP);
});



/*
matched_output
This will find an output definition that matched the passed address.
At this stage this is only really used for Websocket outputs.

*/
function matched_output(outputs, address, type, projectname, debug){
	for (var i = 0; i < outputs.length; i++) {
	var output = outputs[i];
		if(output.enabled && output.type == type && type != "HTTP"){ //can't have HTTP outputs at this stage.
			if("/" + projectname + "/" + output.address == address){
				return {
							"addressUnMatched" : output.address,
							"address" : output.address,
							"parameters" : {},
							"output" : output
						}
			}		
		}
	}
}

/*
Function: matched_input
This function retusn an input if the passes parameters matches. i.e.
It will find the input definitions/nodes defined in the config file
that match the input that you're checking.
It returns an object:
match = {
	"address" : "ProjectName/matchedaddress",
	"parameters" : {if applicable},
	"input" : {the input object which matches.}
}

*/
function matched_input(inputs, address, type, httpMethod, projectname, debug){
	for (var i = 0; i < inputs.length; i++) {
	var input = inputs[i];
		if(input.enabled && input.type == type && 
				(type != "HTTP" || input.method == httpMethod || 
						(input.method == undefined && httpMethod == "GET"))){
			if(typeof(input.address) == "string"){
				if("/" + projectname + "/" + input.address == address){
					return {
								"addressUnMatched" : input.address,
								"address" : input.address,
								"parameters" : {},
								"input" : input
							}
				}
			} else if(typeof(input.address) == "object"){
				var returnParameters = {};
				var matchAddress = input.address.value;
				var foundAll = true;
				for (param in input.address.parameters){
					var paramRE = new RegExp("(.*)\{" + param + "\}(.*)");
					var paramMatch = paramRE.exec(input.address.value);
					var addressRE = new RegExp(paramMatch[1] + "(.*)" + paramMatch[2]);
					var foundParameter = addressRE.exec(address);
					if(foundParameter != null){
						if(input.address.parameters[param].indexOf(foundParameter[1]) != -1 || 
							input.address.parameters[param].indexOf(parseInt(foundParameter[1])) != -1){
							returnParameters[param] = foundParameter[1];
							matchAddress = matchAddress.replace('{' + param + '}', foundParameter[1])
						} else 
							foundAll = false;						
					} else 
						foundAll = false;

				}
				if(foundAll) { //then we have sucessfully found all parameters
					return {
								"addressUnMatched" : input.address.value,
								"address" : matchAddress,
								"parameters" : returnParameters,
								"input" : input
							};
				}
			}			
		}
	}
}

/*
	project_match
	Of all projects defined in the config file,
	find the projectname that matches (if it is defined.)
	If there is no project match then return null.
	
*/
function project_match(address, type, config){
	for(projectID in config.projects){
		if(config.projects[projectID].enabled) {
			projectName = config.projects[projectID].name;
			if(address.substring(1, projectName.length + 1) == projectName) //strip leading '/'
				return config.projects[projectID];
		}
	}
	return null;
}

/*
	perform_action
	Given that the payload on the given address (and project that that corresponding action lives in
		- perform the relevant action).
*/
function perform_action(address, payload, type, httpMethod, config, projectConfig, projectName, debug){
	if (debug == undefined) debug = false;
	inputAndParameters = matched_input(projectConfig.inputs, address, type, httpMethod, projectName, debug);
	if(debug) console.log('received input: ' + payload + ' at address: ' + address);
	if(debug) console.log(inputAndParameters);
	if(inputAndParameters != undefined) 
		perform_transformations(inputAndParameters, payload, config, projectConfig, debug);	
}


/*
	perform_transformations
	given the input & parameter object (for input with dynamic address)
	perform all transformations associated with that input.
	and then write the data to each of the outputs associated with the transofrmers.
*/
function perform_transformations(inputAndParameters, payload, config, projectConfig, debug){
	if (debug == undefined) debug = false;
	projectConfig.transformers.forEach(function (trans) {
		trans.input.forEach(function (traninput) {
			if (traninput == inputAndParameters.input.id && trans.enabled) {
	            var outputarray = perform_transform(inputAndParameters, payload, trans, debug);
				//and then write outputs to those transformation outputs.
				for (outputvaluekey in outputarray) {
				    for(outputID in projectConfig.outputs){
						if (projectConfig.outputs[outputID].id == outputvaluekey && projectConfig.outputs[outputID].enabled) {
							write_output(outputarray[outputvaluekey], projectConfig.outputs[outputID], config, projectConfig, debug);
			            }
			        }
			    }
	        }
		})
	});	
}

/*
	perform_transform
	do the actual data processing 
	i.e. (payload + parameters + address > output)

*/

function perform_transform(inputAndParameters, payload, transNode, debug) {
    if (debug == undefined) debug = false;
    var output = [];
    var outputarray = [];

	var address = inputAndParameters.address;
	var parameters = inputAndParameters.parameters;
	
    if(transNode.type == "JAVASCRIPT") {
		if(debug) console.log('Performing JAVASCRIPT on transformer ' + transNode.id);
		//This eval needs to be cleaned up/secured so code can't be run on the server.
		eval(transNode.process);	
		
	} else if(transNode.type == "PASSTHROUGH"){
		if(debug) console.log('Performing PASSTHROUGH on transformer ' + transNode.id);
		//need to go over each output defined in the array as we don't specically know which output is a passthrough.
		for(outputID in transNode.output){
			output[transNode.output[outputID]] = payload;
		}
	}
	return output;
}


/*
	write_output
	write the data to the defined output.
*/
function write_output(data, output, config, projectConfig, debug) {
	if (debug == undefined) debug = false;
	
	if(data == null)
	 	if (debug) console.log('skipping output' + output.id + ' since data was null');
	else 
		if (debug) console.log('writing output to ' + output.id + ' :: ' + data);
	
	if (output.type == "MQTT") { //send the data back to an MQTT channel - this could realistically be used with MQTT component instead of subprocess.
   	    if (debug) console.log('publishing "' + data + '" to MQTT address: ' + config.MQTTBrokerAddress + ':' + 
				config.MQTTBrokerPort + projectConfig.projectname + '/' + output.address);
	    var pub = require('child_process').spawn,
        //mqttpub = pub('mosquitto_pub-0.10.2.exe', ['-h', 'summer.ceit.uq.edu.au', '-t', config.projectname + '/' + tgt.address, '-m', data]);
		mqttpub = pub('mosquitto_pub', ['-h', 'summer.ceit.uq.edu.au', '-t', projectConfig.projectname + '/' + output.address, '-m', data]);
        mqttpub.stdin.end();
    } else if (output.type == "TCP") { //tcp socket send data, discard anything sent back.
        var socket = new net.Socket();
        if(debug) console.log('publishing "' + data + '" to TCP address: ' + output.address + ':' + output.port);
		socket.connect(output.port, output.address, function () {
            socket.setEncoding("utf8");
            socket.write(data);
            socket.end();
        });
    } else if (output.type == "DATAPOINT") { //write to mysql table  https://github.com/felixge/node-mysql/blob/master/Readme.md
		var dataPointWritten = false;
		for(datapointID in projectConfig.datapoints){
			if(output.datapoint ==  projectConfig.datapoints[datapointID].id){
				var datapoint = projectConfig.datapoints[datapointID];
				var insertstring = format_sql_string(output.table, output.columns, data);
				if(insertstring == -1) {
					console.error('error in DB defintion for transformation: ' + output.id);
				} else {
			        var mysql = require('mysql');
					var client = mysql.createClient({
					  host: datapoint.address,
					  user: datapoint.username,
					  password: datapoint.password,
					  database: datapoint.database
					});
					if (debug) console.log(insertstring);			
			        client.query(insertstring, function selectCb(err, results, fields) {
			            if (err) console.error(err);
			            client.end();
			        });			
				}
				dataPointWritten = true;
			}
		}
		if(!dataPointWritten) console.error('Missing datapoint configuration for ' + output.datapoint);
		
    } else if (output.type == "WEBSOCKET") {
		if(debug) console.log(websocketOutputs);
		for (wsid in websocketOutputs[output.address]) {
			websocketOutputs[output.address][wsid].write(data.toString());
        }
    } else {
        console.error("undefined output type:" + output.type + ' Assigned to output:' + output.id);
    }
}


/*
	format_sql_string
	take a table column description and data and build an 'insert into....' statement, at the moment it only handles 'string' datatypes
	"now()" is a reserved value - the single quotes are removed for this. i.e. it has to be setup in config    output[0][x] = \"now()\" and it will use the SQL time.
	
*/
function format_sql_string(tablename, columns, data) {
	for(datacolumn in data) { //check that all data columns are in table description
		if(columns.indexOf(datacolumn) == -1){
			return -1;
		}
	}
	for(columnname in columns) { //check that all data columns are in table description
		if(!(columns[columnname] in data)){
			return -1;
		}
	}
	
	columnstr = "(";
	datastr = "VALUES(";
	for (columnname in data){
		columnstr += columnname + ", ";
		if(data[columnname] == "now()")
		 	datastr += "now(), ";
		else
			datastr += "'" + data[columnname] + "', ";
	}
	columnstr = columnstr.substring(0, columnstr.length - 2) + ") ";
	datastr = datastr.substring(0, datastr.length - 2) + ");";
	str = "insert into " + tablename + columnstr + datastr;
	return str;
	
}