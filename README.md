MQTT data transformation layer (MQTTDTL)
========

Introduction
--------
MQTT is designed as a framework for handling realtime data, written
in node.js. The best physical analogy is an audio 'patch panel'. 

After defining input channels and output channels you can then
describe how data is passed between those endpoints and what
business logic or data processing is performed on the input data
before sent to one or multiple outputs.

This concept came from necessity after wanting to quickly 'patch' data
for a number of different projects based on the MQTT protocol.


Inputs and Outputs
-------
Since then, it has branched to allow many different input and 
outputs types (all revolved around processing realtime data)

Protocols currently include:

* MQTT (both publish and subscribe)
* Websocket (both input and output)
* TCP (only send currently implemented)
* HTTP (input only - GET and POST)
* MYSQL (output and data 'lookup' only)

An example of a simple HTTP Get input:

		{
			"id" : "raw",
			"description" : "This will listen on the defined web server on /ProjectName/raw The payload will be passed as the ?getParameter"
			"enabled" : true,
			"type" : "HTTP",
			"method" : "GET",
			"address" : "raw"
	 	}

As well as standard addresses, inputs can also be defined for 
address sets. An address set can include an argument within the address
value. 
i.e. you can have multiple physical inputs using one description 
e.g. to refer to multiple sensors at address
* /ProjectName/Sensors/Light/1/raw
* /ProjectName/Sensors/Light/2/raw
	
An example of a MQTT input that handles multiple parameters:

		{
			"id" : "lightSensor",
			"enabled" : true,
			"description" : "MQTT pub /ProjectName/Sensors/Light/x/raw where x can be anywhere from 1 to 10",
			"type" : "MQTT",
			"address" : 
				{
					"value" : "Sensors/Light/{sensorID}/raw",
					"parameters" : 
							{"sensorID" : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
				}
		 }

These parameters can then be accessed in the data transformer via the parameter['name'] array.


Datapoints
-------
This project has also introduced the concept of a datapoint. A datapoint
is essentially any data storage server that can be written to as an output
or that values can be read from (see a lookup transformation).
Data points are defined in the project definition:

		{
			"id" : "localMYSQLTestDB",
			"type" : "MYSQL",
			"enabled" : true,
			"address" : "127.0.0.1",
			"username" : "root",
			"password" : "root",
			"database" : "Test"
		}


Transformers
-------
The logic behind the transformation of data is built into the data
'transformers'. They are defined as receiving input from one predefined
input and then performing an action on that data.

Although the current processing is very simple (i.e. you can currently
execute some node.js on the input parameters to generate an output set).
This has the potential to be expanded with the ability to define an 
executable, pass the input parameters to this executable and pipe the
standard out of this process to the defined outputs.

Data accessible to any JAVASCRIPT transformations:

		var payload (str)			The input data.
		var address (str)			The address that this transformer has been fired on.
		var parameters {object}	If the input has input parameters

Data output from the transformer must be in an object with an output for each 
defined output for that transoformations.

		var output = {'outputname1' : 'output data1', 'outputname2' : 'output data2'}


A simple web socket passthrough example, will pass MQTT to a web socket:

		{
			"id" : "MQTTtoWS",
			"enabled": true,
			"description" : "will pass through MQTT > WS"
			"input": ["mqttInput"],
			"output": ["WSOutput"],
			"type" : "JAVASCRIPT",
			"process" : "output['WSOutput'] = payload;"
		}




A full Example
-------
Below is a full example of the configurations used to set up
a simple two point Web Socket chat server, there is also the ability
the HTTP POST some data to chat Websocket and log that information.

In it's current form, the Websocket and HTTP server is running locally
on the MQTTDL server, however the idea is that this can be distributed
in the future.

There are two configuration files, one for the application
and one for the project, the application config defines which projects
are currently enabled and where their project specific config lies.

config.json:

		{
			"MQTTBrokerAddress" : "summer.ceit.uq.edu.au",
			"MQTTBrokerPort" : 1883,
			"HTTPBindIP" : "172.16.174.132",
			"HTTPBindPort" : 8080,

			"WEBSocketIP" : "172.16.174.132",
			"WebSocketPort" : 8081,

			"projects" :
			[
				{
					"name" : "testChat",
					"enabled" : true,
					"configPath" : "config/test.json"
				}
			]
		}


config/test.json:

		{
		"projectname" : "testChat",
			"datapoints" : 
			[
				{
					"id" : "localMYSQL",
					"type" : "MYSQL",
					"enabled" : true,
					"address" : "127.0.0.1",
					"username" : "root",
					"password" : "root",
					"database" : "Log"
				}
			],
		"inputs" : 
			[
				{
					"id" : "P1in",
					"description" : "http://WEBSocketIP:WebSocketPort/testChat/P1",
					"enabled" : true,
					"type" : "WEBSOCKET",
					"address" : "P1"
			 	},
				{
					"id" : "P2in",
					"description" : "http://WEBSocketIP:WebSocketPort/testChat/P2",
					"enabled" : true,
					"type" : "WEBSOCKET",
					"address" : "P2"
			 	},
				{
					"id" : "postData",
					"description" : "POST http://HTTPBindIP:HTTPBindPort/chat/1 or /chat/2",
					"enabled" : true,
					"type" : "HTTP",
					"method" : "POST",
					"address" : 
						{
							"value" : "chat/{ID}",
							"parameters" : 
									{"ID" : [1, 2]}
						}
				}
			],
		"outputs" : 
			[
				{
					"id" : "P1out",
					"description" : "http://WEBSocketIP:WebSocketPort/testChat/P1",
					"enabled" : true,
					"type" : "WEBSOCKET",
					"address" : "P1"
			 	},
				{
					"id" : "P2out",
					"description" : "http://WEBSocketIP:WebSocketPort/testChat/P2",
					"enabled" : true,
					"type" : "WEBSOCKET",
					"address" : "P2"
			 	},
				{
					"id" : "PostLog",
					"enabled" : true,
					"type" : "DATAPOINT",
					"datapoint" : "localMYSQL",
					"table" : "PostLog",
					"columns" : ["happened", "whoTo", "what"]
				}
			],
		"transformers" :
			[
				{
					"id" : "P1toP2",
					"enabled": true,
					"input": ["P1in"],
					"output": ["P2out"],
					"type" : "JAVASCRIPT",
					"process" : "output['P2out'] = 'P1 says: ' + payload;"
				},
				{
					"id" : "P2toP1",
					"enabled": true,
					"input": ["P2in"],
					"output": ["P1out"],
					"type" : "JAVASCRIPT",
					"process" : "output['P1out'] = 'P2 says: ' + payload;"
				},
				{
					"id" : "PostLogTrans",
					"enabled" : true,
					"input" : ["postData"],
					"output" : ["PostLog"],
					"type" : "JAVASCRIPT",
					"process" : "output['PostLog'] = {happened: 'now()', whoTo: parameters['ID'], what: payload};"
				},
				{
					"id" : "PostLogTrans",
					"enabled" : true,
					"input" : ["postData"],
					"output" : ["P1out", "P2out"],
					"type" : "JAVASCRIPT",
					"process" : "if(parameters['ID']==1){output['P1out']=payload;output['P2out']=null;} else {output['P1out']=null;output['P2out']=payload;}"
				}
			]
		}







TODO still
-------

Notes on HTTP:
 The current implementation uses a local HTTP server (on the MQTTDTL Server).
 Note that HTTP is currently only of form INPUT, the reason for this is that
 I haven't come up with a good way of handling the "real time data" aspect
 of all other inputs and outputs and how this contrasts to HTTP.


Ideas for future enhancement:
 RSS inputs
 RSS outputs
 MAIL output.
 IMAP inputs.
	payload is body
	subject is address.
	projectname@<serveraddress>.com
 HTTP GET which reads persistent value (transformer pips some value to an
   output (which is also the same HTTP input))
 HTTP - "responce" field as an option on the input which you could have a transformer feedback to a HTTP input.
 
for transformers:

 		{				
			"onfail": "input[0] = '';" ,
			"onsucess": ""
		}
		{
			"type" : "MYSQLLOOKUP",
			"process" : 
				{"table" : "stateinfo",
				"column" : "statexmldesc",
				"lookupfield" : "stateid",
				"lookupvalue" : payload
				//select statexmldesc from stateinfo where stateid = 'payload';
				}
		}
		
		
possible failes are:
*	transformer code fail
*	transformer db lookup fail.
*	tcp host fail
*	mqtt host fail.
*	websocket no client listening.
*	tranformer logic reports fail.
*	invalid input.
*	address does not exist. e.g. address request: AVControl/doesn'texist	
*	project does not exist.
	
	
other ideas:
*	various config files hosted on the server (i.e. projectname.json which is read once an input is received).
*	if that config file does not exist then it will return 'project does not exist' error.
*	if that config file does exist it will evaluate all defined inputs and if an input does not exist it will return "Address does not exist".
*	server config is the address and ports that it takes input from i.e. mqtt server, http bind address etc.
*	project config defines the input addresses, output addresses etc.
*	indexes are string not numbers (therefor your transformers for MYSQL will go to the column name also.
*	for input paramters, your transfrormer will refer to that by a parameter[inputparametername] array.
	
	
	
	
TODO 27/7/2011:

1. Address Parameters - done.
1 a) transformers utilise the parameters passed. done.
2. IDs are names instead of ints. - done.
2. Transformers with MYSQL lookups.
3. onsucess and onfail actions (output back to input)
4. sql uses column names as index for output array. - done.

for demo:
http://172.16.174.132/all/aLL.php
