// ****************************************************************
// LivePerson EMEA Sales Consulting Connector for Watson Assistant.
// ****************************************************************

require('dotenv').config();

// ****************************************************************
// This section is for the deployment of the connector on heroku.
// You can comment this out when running locally.
// ****************************************************************
var http = require('http');
http.createServer(function(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write('LivePerson EMEA SC Connector for Watson Assistant');
    res.end();
}).listen(process.env.PORT || 6000);

// Ping the connector every 10 minutes to minimise socket timeouts
var connectorName = process.env.CONNECTOR_NAME;
var connectorURL = 'http://' + connectorName + '.herokuapp.com';
setInterval(function() {
    http.get(connectorURL);
}, 600000);
// ****************************************************************
// End of heroku section.
// ****************************************************************

///////////////////////////////////////////////
////         MySQL Connection Made         ////
///////////////////////////////////////////////
var mysql = require('mysql');

var con = mysql.createPool({
   connectionLimit: 10,
   host: "den1.mysql4.gear.host",
   user: "ppbdb1",
   password: "Yr4iF02-E25?",
   database: "ppbdb1"
});

////////////////////////////////////////////////

var watson = require('watson-developer-cloud');
var messagingAgent = require('./messagingAgent');
var request = require('request');
var umsDialogToWatsonContext = {};
var answer = "";
var sc_answer = "";
var metadata = "";
var abc_metadata = "";
var qr_metadata = "";
var typingdelay = parseInt(process.env.TYPING_DELAY, 10); // Convert the TYPING_DELAY env. variable to an integer.
var snippetdelay = parseInt(process.env.SNIPPET_DELAY, 10); // Convert the ANSWER_DELAY env. variable to an integer.
var closedelay = parseInt(process.env.CLOSE_DELAY, 10); // Convert the CLOSE_DELAY env. variable to an integer.
var waittime = 0;
var item = 0;
var snippet = [];
var allSkills = [];
var accountId = process.env.LP_ACCOUNT_ID;
var greenlight = 1;

// Watson Assistant credentials.
var assistant = new watson.AssistantV1({
    username: process.env.WCS_USERNAME,
    password: process.env.WCS_PASSWORD,
    version: '2018-02-16'
});

// LE bot agent credentials.
var echoAgent = new messagingAgent({
    accountId: process.env.LP_ACCOUNT_ID,
    username: process.env.LP_ACCOUNT_USER,
    appKey: process.env.LP_ACCOUNT_APP_KEY,
    secret: process.env.LP_ACCOUNT_SECRET,
    accessToken: process.env.LP_ACCOUNT_ACCESS_TOKEN,
    accessTokenSecret: process.env.LP_ACCOUNT_ACCESS_TOKEN_SECRET
});

// API OAuth1 credentials.
var oauth = {
    consumer_key: process.env.LP_API_APP_KEY,
    consumer_secret: process.env.LP_API_SECRET,
    token: process.env.LP_API_ACCESS_TOKEN,
    token_secret: process.env.LP_API_ACCESS_TOKEN_SECRET
};

// ****************************************************************
// This code gets executed on start-up when the bot connects.
// ****************************************************************
// Calls the retrieveBaseURI function which in turn calls the
// retrieveSkills function (using the correct baseURI). This loads
// an array with Skill IDs and the corresponding Skill Names from
// LiveEngage which is used when transferring conversations.
// ****************************************************************
echoAgent.on('connected', data => {
    retrieveBaseURI();
});

// ****************************************************************
// This code gets executed when an inbound message is received.
// ****************************************************************
// Takes the last utterance sent by a customer and passes this to
// Watson Assistant, then calls the processResponse function with
// the response from Watson Assistant.
// ****************************************************************
echoAgent.on('messagingAgent.ContentEvent', (contentEvent) => {

    greenlight = 1;
    message = contentEvent.message;

    setTimeout(function(){

        if(greenlight){
            if(typeof contentEvent.message !== 'object'){ // Check to make sure that the message from the customer is plain text.
                console.log("Sending message: " + contentEvent.message);
                assistant.message({											 /////
                    workspace_id: process.env.WCS_WORKSPACE_ID,					//
                    input: {text: message},										//
                    context : umsDialogToWatsonContext[contentEvent.dialogId]	//////-- Sends message to Watson in Json format  	
                }, (err, res) => {												//
                    processResponse(err, res, contentEvent.dialogId);			//
                });															 /////
                greenlight = 0;
            }
            else { // If the message is not plain text (i.e. image or audio-clip) then handle appropriately.
                console.log("Sending message: *** Image or audio-clip object detected and blocked ***");
                message = "Unfortunately I cannot process images or audio clips at this time. Please send a plain text response.";
                console.log('Return message : ' + message.substring(0, 50) + '...'); // Post the answer to the console, truncated for readability.
                sendPlainText(message, contentEvent.dialogId);
            }
        }

    }, 100); // Pause for 100 milliseconds so only the last utterance from the customer is processed.
             // This is to prevent multiple utterances being processed when a conversation is transferred to the bot.

});

// ****************************************************************
// This function processes each response from Watson Assistant.
// ****************************************************************
function processResponse(err, response, dialogID) {
    if (err) {
        console.error(err); // Oops - something went wrong.
        return;
    }

    umsDialogToWatsonContext[dialogID] = response.context;

    if (response.output.text.length != 0) {

        // Initiate typing indicator prior to the bot response.
        startTyping(dialogID);

        // If an intent is detected, log it out to the console with confidence level.
        if (response.intents.length > 0) {
            console.log('Detected intent: #' + response.intents[0].intent + ' - with a confidence of: ' + response.intents[0].confidence);
        }

        // If an entity is detected, log it out to the console with confidence level.
        if (response.entities.length > 0) {
            console.log('Detected entity: @' + response.entities[0].entity + ' - with a confidence of: ' + response.entities[0].confidence);
        }

        setTimeout(function() { // Set the time-out function to simulate a delay from Watson so we can show the typing indicator.

            for (var i = 0; i < response.output.text.length; i++) {

                // Cancel typing indicator before the bot responds.
                finishTyping(dialogID);

                answer = response.output.text[i];

                console.log('Return message : ' + answer.substring(0, 50) + '...'); // Post the answer to the console, truncated for readability.

                // If structured content is detected, evaluate the type of structured content and process appropriately.
                if (answer.startsWith("{")) {

                    // Check to see if an endpoint specific type of structured content is detected.
                    if (typeof response.output.endpoint !== "undefined") {

                        var delayTotal = 0;

                        if (response.output.endpoint.delay_multiplier !== "undefined") {
                            delayTotal = response.output.endpoint.delay_multiplier * snippetdelay;
                        }

                        setTimeout(function() {

                            // If endpoint is identified as ABC then send as ABC Structured Content.
                            if (response.output.endpoint.type === "abc") {
                                metadata = response.output.endpoint.value;
                                sendABCStructuredContent(answer, metadata, dialogID);
                            // Else if structured content contains a QuickReply then send as QR Structured Content. (Quick Reply is options for customer in bubble form)
                            } else if (response.output.endpoint.type === "quickreplies") {
                                metadata = response.output.endpoint.value;
                                sendQRStructuredContent(answer, metadata, dialogID);
                            // Else if send as regular structured content.
                            } else if (response.output.endpoint.type === "lpsc") {
                                sendStructuredContent(answer, dialogID);
                            }

                        }, delayTotal);

                    // Otherwise send as regular Structured Content.
                    } else {
                        sendStructuredContent(answer, dialogID);
                    }

                }

                // Else if line breaks in plain text message are detected, send as snippets.
                else if (answer.includes('|')) {

                    console.log('Message format : Plain text with snippets');
                    // Split the response into an array of snippets, and trim any whitespace either side of the snippets.
                    var answerarray = answer.split('|').map(item => item.trim());

                    // Send the first snippet directly so there is no delay after typing indicator.
                    item = 0;
                    snippet = answerarray[item];
                    if (snippet.length != 0) {
                        sendMySnippet(snippet, item, dialogID);
                    } else {
                        console.log('     Snippet ' + item + ' : -> *** blank snippet ***');
                    }

                    // Subsequent snippets are then sent via a callback function with the pre-defined snippet delay.
                    item = 1;
                    sendResponseSnippet(answerarray, item, dialogID, 0, function(err, resp) {});

                }

                // Otherwise the response should just be sent a plain text.
                else {

                    sendPlainText(answer, dialogID);

                }

                // Identify and then process any ACTIONS specified in the JSON response.
                if (typeof response.output.action !== "undefined") {
                    if (typeof response.output.action.name !== "undefined") {

                        // If an action is detected, log the action out to the console.
                        console.log('Detected action: ' + response.output.action.name);

                        // If a close action is detected, close the conversation after a delay.
                        if (response.output.action.name === "close") {
                            setTimeout(function() { // Apply timeout function so customer can see the close message before the exit survey is displayed.
                                closeConversation(dialogID);
                            }, closedelay) // delay in milliseconds before closing the conversation.
                        }
	
			if (response.output.action.name === "custlookupemail") {
				var email = response.output.action.email;
				console.log('Email lookup: ' + email);
				custlookup(email, dialogID);
				return;
			}
			
			if (response.output.action.name === "lookupemail") {
				var name = response.output.action.fullname;
				console.log('Email lookup for: ' + name);
				lookupemail(name, dialogID);
				return;
			}
			               
			if (response.output.action.name === "doblookup") {
	                        var email = response.output.action.email;
	                        var answer = response.output.action.answer;
	                        console.log('Date of Birth lookup: ' + answer + " " + email);
	                        doblookup(email, answer, dialogID);
	                        return;
                        }
                        
         if (response.output.action.name === "deepsearch") {
			       	var name = response.output.action.fullname;
	             	var answer = response.output.action.answer;
				console.log('Deep Search');
				namesearch(name, answer, dialogID)
				return;
			}      
         
			if (response.output.action.name === "SQlookup") {
				var email = response.output.action.email;
				console.log('Security Question lookup: ' + email);
				SQlookup(email, dialogID);
				return;
			}    
			
			if (response.output.action.name === "SAlookup") {
	                        var email = response.output.action.email;
	                        var sanswer = response.output.action.sanswer;
	                        console.log('Security Answer lookup for: ' + email);
	                        SAlookup(email, sanswer, dialogID);
	                        return;
                        }
                        
         if (response.output.action.name === "Pokerlookup") {
               var email = response.output.action.email;
	            console.log('Poker wallet lookup for: ' + email);
	            Pokerlookup(email, dialogID);
	            return;
            }

         if (response.output.action.name === "Mainlookup") {
               var email = response.output.action.email;
	            console.log('Poker wallet lookup for: ' + email);
	            Mainlookup(email, dialogID);
	            return;
            }

         if (response.output.action.name === "Exchangelookup") {
               var email = response.output.action.email;
	            console.log('Exchange wallet lookup for: ' + email);
	            Exchangelookup(email, dialogID);
	            return;
            }
            
         if (response.output.action.name === "transfer_funds") {
	         var email = response.output.action.email;	
	         var amount = response.output.action.amount;
	         var fromWallet = response.output.action.fromWallet;
	         var toWallet = response.output.action.toWallet;
	         console.log('Transfer funds: From:' + fromWallet + 'To:' + toWallet + 'Amount:' + amount);
	         transfer_funds(email, amount, fromWallet, toWallet, dialogID);
         }

                        // If an escalate action is detected, transfer to the specified human skill.
                        // If the transfer is requested during out-of-hours then set the right expectation with the customer.
                        if (response.output.action.name === "escalate") {

                            var currentDtTm = new Date();
                            var currentHour = currentDtTm.getHours();
                            var currentMins = currentDtTm.getMinutes();
                            var openHour = process.env.OPERATING_HOURS_START_HH;
                            var openMins = process.env.OPERATING_HOURS_START_MM;
                            var closeHour = process.env.OPERATING_HOURS_END_HH;
                            var closeMins = process.env.OPERATING_HOURS_END_MM;
                            var off_hours = true; // Assume off hours is true until it is evaluated as false.
                            var skillName = response.output.action.skill; // Set skillName to the value in the JSON response.
                            var skillId = convertSkill(skillName); // Convert skillName to skillId.

                            console.log('Opening hours  : ' + openHour + ':' + openMins + ' - ' + closeHour + ':' + closeMins);

                            if (currentHour > openHour && currentHour < closeHour) {  ////
                                off_hours = false;										//
                            } else if (currentHour == openHour) {						//
                                if (currentMins >= openMins) {							//
                                    off_hours = false;									//
                                }														////// - Checks if it is off hours for CS or not
                            } else if (currentHour == closeHour) {						//	
                                if (currentMins < closeMins) {							//
                                    off_hours = false;									//
                                }														//
                            }														  ////

                            if (off_hours) {
                                console.log('Current time   : ' + currentHour + ':' + currentMins + ' - Out of hours detected, sending notification snippets...');
                                var transferMessageOne = process.env.OPERATING_HOURS_MSG_1 + ' ' + openHour + ':' + openMins + ' - ' + closeHour + ':' + closeMins + '.';
                                var transferMessageTwo = process.env.OPERATING_HOURS_MSG_2;
                                var answerarray = [transferMessageOne, transferMessageTwo];

                                // Send operating hours info message snippets after regular transfer message.
                                sendResponseSnippet(answerarray, 0, dialogID, function(err, resp) {});

                                // Then transfer the conversation to the specified skill after all messages have been sent.
                                waittime = snippetdelay * 3;
                                setTimeout(function() {
                                    transferConversation(skillId, dialogID);
                                }, waittime);

                            } else {
                                console.log('Current time   : ' + currentHour + ':' + currentMins);
                                transferConversation(skillId, dialogID);

                            }
                        }
                    }
                }
            }
        }, typingdelay) // delay in milliseconds before removing the typing indicator.
    }
}

// ****************************************************************
// Functions which are called by the main processResponse function.
// ****************************************************************

// This function sends a Plain Text message to the UMS.
function sendPlainText(answer, dialogID) {

    console.log('Message format : Plain text');
    echoAgent.publishEvent({
        dialogId: dialogID,
        event: {
            type: 'ContentEvent',
            contentType: 'text/plain',
            message: answer
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function sends a Structured Content message to the UMS.
function sendStructuredContent(answer, dialogID) {

    console.log('Message format : LP Structured Content');
    sc_answer = JSON.parse(answer);

    echoAgent.publishEvent({
        dialogId: dialogID,
        event: {
            type: 'RichContentEvent',
            content: sc_answer
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function sends an ABC Structured Content message to the UMS.
function sendABCStructuredContent(answer, metadata, dialogID) {

    console.log('Message format : ABC Structured Content');
    sc_answer = JSON.parse(answer);
    abc_metadata = JSON.parse(metadata);

    echoAgent.publishEvent({
        dialogId: dialogID,
        event: {
            type: 'RichContentEvent',
            content: sc_answer
        }
    }, null, abc_metadata, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function sends an ABC Structured Content message to the UMS.
function sendQRStructuredContent(answer, metadata, dialogID) {

    console.log('Message format : LP Structured Content - QuickReply');
    sc_answer = JSON.parse(answer);
    qr_metadata = metadata;

    echoAgent.publishEvent({
        dialogId: dialogID,
        event: {
            type: 'ContentEvent',
            contentType: 'text/plain',
            message: qr_metadata,
            quickReplies: sc_answer
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function initiates the snippet callback function.
function sendResponseSnippet(answerarray, item, dialogID) {

    callbackSnippet(answerarray, item, dialogID, function(err, resp) {});

}

// This function recurses through the message snippet array and calls the sendMySnippet function.
function callbackSnippet(answerarray, item, dialogID, callback) {

    snippet = answerarray[item];
    setTimeout(function() {

        if (snippet.length != 0) {
            sendMySnippet(snippet, item, dialogID);
        } else {
            console.log('     Snippet ' + item + ' : -> *** blank snippet ***');
        }
        item = item + 1;
        if (item < answerarray.length) {
            callbackSnippet(answerarray, item, dialogID, callback);
        }
    }, snippetdelay);

}

// This function simply sends each snippet!
function sendMySnippet(snippet, item, dialogID) {

    console.log('     Snippet ' + item + ' : -> ' + snippet.substring(0, 47) + '...');
    echoAgent.publishEvent({
        dialogId: dialogID,
        event: {
            type: 'ContentEvent',
            contentType: 'text/plain',
            message: snippet
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function closes an active conversation.
function closeConversation(dialogID) {

    setTimeout(function() {
    echoAgent.updateConversationField({
        conversationId: dialogID,
        conversationField: [{
            field: "ConversationStateField",
            conversationState: "CLOSE"
        }]
    }, function(err) {
        if (err) {
            console.log(err);
        } else {
            console.log("*** Conversation has been closed ***");
            delete umsDialogToWatsonContext[dialogID];
        }
    });
}, 500);

}

// This function transfers the active conversation to the specified skill.
function transferConversation(skillId, dialogID) {

    echoAgent.updateConversationField({
        conversationId: dialogID,
        conversationField: [{
                field: "ParticipantsChange",
                type: "REMOVE",
                role: "ASSIGNED_AGENT"
            },
            {
                field: "Skill",
                type: "UPDATE",
                skill: skillId
            }
        ]
    }, function(err) {
        if (err) {
            console.log(err);
        } else {
            console.log("*** Transfer to SkillId '" + skillId + "' completed ***");
        }
    });

}



function custlookup(email, dialogID) {

	con.getConnection(function(err, connection) {
		if (err) throw err;
		var query = "SELECT * FROM Customers WHERE Email = \'" + email + "\'";
		connection.query(query, function (err, result) {
			connection.release();
			if (err) throw err;
			console.log(result);
		if (result.length!= 0) {
			var message = "found";
		}
		else {
			var message = "not found";
		}
		actionsend(message, dialogID);
		//connection.release();
      });
   });

}


function lookupemail(name, dialogID) {

	con.getConnection(function(err, connection) {
		if (err) throw err;
		var query = "SELECT * FROM Customers WHERE Name = \'" + name + "\'";
		connection.query(query, function (err, result) {
			connection.release();
			if (err) throw err;
			console.log(result[0]['Email']);
		if (result.length!= 0) {
			var message = result[0]['Email'];
			console.log(message);
		}
		else {
			var message = "not found";
		}
		actionsend(message, dialogID);
      //connection.release();
      });
   });

}

function actionsend(message, dialogID) {
   var contentEvent = messagingAgent.ContentEvent;
   assistant.message({											 /////
      workspace_id: 'e1d4da47-544a-43b7-8f0c-80b11fd30912',					//
      input: {text: message},										//
      context : umsDialogToWatsonContext[dialogID]	//////-- Sends message to Watson in Json format  	
   }, (err, res) => {												//
      processResponse(err, res, dialogID);			//
   });
}

function doblookup(email, answer, dialogID, callback) {

	con.getConnection(function(err, connection) {
		if (err) throw err;
		var query = "SELECT * FROM Customers WHERE DOB = \'" + answer + "\' AND EMAIL = '" + email+ "\'";
		connection.query(query, function (err, result) {
			if (err) throw err;
			console.log(result);
		if (result.length!= 0) {
			var message = "found";
		}
		else {
			var message = "not found";
		}
		actionsend(message, dialogID);
      connection.release();
      });
   });
}

function namesearch(name, answer, dialogID) {

	con.getConnection(function(err, connection) {
		if (err) throw err;
		var query = "SELECT * FROM Customers WHERE Name = \'" + name + "\'";
		connection.query(query, function (err, result) {
			connection.release();
			if (err) throw err;
			console.log(result);
		if (result.length!= 0) {
			return doblookup2(name, answer, dialogID);
		}
		else {
			return false;
		}
      });
   });
}

function doblookup2(name, answer, dialogID, callback) {

	con.getConnection(function(err, connection) {
		if (err) throw err;
		var query = "SELECT * FROM Customers WHERE DOB = \'" + answer + "\' AND Name = '" + name + "\'";
		connection.query(query, function (err, result) {
			if (err) throw err;
			console.log(result);
		   if (result.length!= 0) {
			   var message = "found";
		   }
		   else {
			   var message = "not found";
		   }
		   actionsend(message, dialogID);
		   connection.release();
      });
   });
}

function SQlookup(email, dialogID) {

   con.getConnection(function(err, connection) {
      if (err) throw err;
		var query = "SELECT SQ FROM Customers WHERE EMAIL = \'" + email+ "\'";
		connection.query(query, function (err, result) {
		   if (err) throw err;
			   console.log(result[0]['SQ']);
		   if (result.length!= 0) {
			   var message = result[0]['SQ'];
		   }
		   else {
			   var message = "not found";
		   }
		   actionsend(message, dialogID);
     connection.release();
     });
   });
}

function SAlookup(email, sanswer, dialogID, callback) {

   con.getConnection(function(err, connection) {
		      if (err) throw err;
		      var query = "SELECT SA FROM Customers WHERE EMAIL = \'" + email + "\' AND SA = \'" + sanswer + "\'";
		      connection.query(query, function (err, result) {
			      if (err) throw err;
		      if (result.length!= 0) {
			      var message = "found";
		      }
		      else {
			      var message = "not found";
		      }
		      actionsend(message, dialogID);
		      connection.release();
	   });
   });
}


   function Pokerlookup(email, dialogID) {

	   con.getConnection(function(err, connection) {
		   if (err) throw err;
		   console.log('lalala');
		   var query = "SELECT pokerwallet FROM Customers WHERE EMAIL = \'alexmurphy1996@yahoo.ie\'";
		   connection.query(query, function (err, result) {
			   if (err) throw err;
			   console.log(result[0]['pokerwallet']);
		   if (result.length!= 0) {
			   var message = result[0]['pokerwallet'];
			   message = message.toString();
		   }
		   else {
			   var message = "not found";
		   }
		   actionsend(message, dialogID);
        connection.release();
	     });
	   });
   }

   function Mainlookup(email, dialogID) {

	   con.getConnection(function(err, connection) {
		   if (err) throw err;
		   console.log('lalala');
		   var query = "SELECT mainwallet FROM Customers WHERE EMAIL = \'alexmurphy1996@yahoo.ie\'";
		   connection.query(query, function (err, result) {
			   if (err) throw err;
			   console.log(result[0]['mainwallet']);
		   if (result.length!= 0) {
			   var message = result[0]['mainwallet'];
			   message = message.toString();
		   }
		   else {
			   var message = "not found";
		   }
		   actionsend(message, dialogID);
        connection.release();
	     });
	   });
   }

   function Exchangelookup(email, dialogID) {

	   con.getConnection(function(err, connection) {
		   if (err) throw err;
		   console.log('lalala');
		   var query = "SELECT exchangewallet FROM Customers WHERE EMAIL = \'alexmurphy1996@yahoo.ie\'";
		   connection.query(query, function (err, result) {
			   if (err) throw err;
			   console.log(result[0]['exchangewallet']);
		   if (result.length!= 0) {
			   var message = result[0]['exchangewallet'];
			   message = message.toString();
		   }
		   else {
			   var message = "not found";
		   }
		   actionsend(message, dialogID);
        connection.release();
	     });
	   });
   }
   
   function transfer_funds(email, amount, fromWallet, toWallet, dialogID) {
      con.getConnection(function(err, connection) {
		   if (err) throw err;
		   var query = "UPDATE Customers SET " + fromWallet + "wallet = " + fromWallet + "wallet - " + amount + ", " + toWallet + "wallet = " + toWallet + "wallet + " + amount + " WHERE Email = '" + email+ "'";
		   connection.query(query, function (err, result) {
			   if (err) throw err;
			   console.log(result);
			});
      });
   }


// This function retrieves the baseURI for the 'accountConfigReadWrite' service from the LiveEngage account.
function retrieveBaseURI() {

    var url = 'https://api.liveperson.net/api/account/' + accountId + '/service/accountConfigReadWrite/baseURI.json?version=1.0';
    request.get({
        url: url,
        oauth: oauth,
        json: true,
        headers: {
            'Content-Type': 'application/json'
        }
    }, function(e, r, b) {
        var baseURI = b.baseURI;
        console.log('*** baseURI for accountConfigReadWrite service: ' + baseURI + ' ***');
        retrieveSkills(baseURI); // Now call the function to retrieve the Skill ID's and corresponding Skill Names.
    });

}

// This function retrieves all the Skill ID's and corresponding Skill Names and loads into an array.
function retrieveSkills(baseURI) {

    var url = 'https://' + baseURI + '/api/account/' + accountId + '/configuration/le-users/skills';
    request.get({
        url: url,
        oauth: oauth,
        json: true,
        headers: {
            'Content-Type': 'application/json'
        }
    }, function(e, r, b) {
        allSkills = b;
        console.log('*** Skills IDs and Skill Names successfully retrieved ***');
    });

}

// This function converts a Skill Name to a Skill ID.
function convertSkill(skillName) {

    var found = 0;
    for (var i = 0; i < allSkills.length; i++) {
        if (allSkills[i].name === skillName) {
            found = 1;
            console.log('Detected skill : ' + allSkills[i].name + ' <--> ' + allSkills[i].id);
            return allSkills[i].id;
        }
    }
    if (!found) {
        console.log('*** WARNING: skill not found ***');
        return -1;
    }

}

// This function initiates the typing indicator.
function startTyping(dialogID) {

    echoAgent.publishEvent({
        "dialogId": dialogID,
        "event": {
            "type": "ChatStateEvent",
            "chatState": "COMPOSING"
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

// This function stops the typing indicator.
function finishTyping(dialogID) {

    echoAgent.publishEvent({
        "dialogId": dialogID,
        "event": {
            "type": "ChatStateEvent",
            "chatState": "ACTIVE"
        }
    }, (res, body) => {
        if (res) {
            console.error(res);
            console.error(body);
        }
    });

}

/*********************************** EOF ***********************************/
