var POINTS = require('../model/points.js');
var core = require('../core.js');
var mongoose = require('mongoose');
var Users = mongoose.model('Users');
var Challenges = mongoose.model('Challenges');
var Pulls = mongoose.model('Pulls');
var https = require('https');
var markdown = require( "markdown" ).markdown;

/*
View all challenges.
*/
exports.index = function(req, res) {
  var uid = ((req.session.auth) ? req.session.auth.github.user.id : null);
  var _self = {};

  Users.findOne({'user_id': uid}).exec(gotUser);

  function gotUser(err, user) {
    _self.user = user;

    Challenges.find().exec(gotChallenges);
  }

  function gotChallenges(err, ch) {
    res.render('challenges', {
      title:      "All challenges",
      user:       _self.user,
      challenges: ch
    })
  };
};

/*
Single challenge page.
*/
exports.one = function(req, res) {
  var uid = ((req.session.auth) ? req.session.auth.github.user.id : null);

  var _self = {};
  var preq = [];

  Users.findOne({'user_id': uid}).exec(gotUser);

  function gotUser(err, user) {
    _self.user = user;
    Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);
  }

  function gotChallenge(err, ch) {
    if (!ch) return res.render('404', {title: "404: File not found"});

    // Formate dates
    ch.end_f = "", ch.start_f = "";
    if (ch.start) {
      ch.start_f += ("0" + ch.start.getUTCDate()).slice(-2) + "/";
      ch.start_f += ("0" + (ch.start.getUTCMonth()+1)).slice(-2) + "/";
      ch.start_f += ch.start.getUTCFullYear();
    }
    if (ch.end) {
      ch.end_f += ("0" + ch.end.getUTCDate()).slice(-2) + "/";
      ch.end_f += ("0" + (ch.end.getUTCMonth()+1)).slice(-2) + "/";
      ch.end_f += ch.end.getUTCFullYear();
    }

    // Markdown description and about section
    ch.description_mk = markdown.toHTML(ch.description);
    ch.about_mk = markdown.toHTML(ch.about);

    // Check if current user is admin
    if (uid && ch.admins.indexOf(req.session.auth.github.user.login) > -1)
      _self.user.admin = true;
    else if (req.path.substring(req.path.lastIndexOf('/')) == '/admin')
      return res.redirect('/challenges/' + req.params.ch);

    // Init individual repos pull req counters
    ch.created_no = [];
    ch.merged_no = [];
    for (var r in ch.repos) {
      ch.created_no[r] = 0;
      ch.merged_no[r] = 0;
    }

    // Get number of merged pull req and
    // count pulls for each
    ch.merged = 0, ch.created = 0;
    for (var i in ch.pulls) {

      // Count pull req
      for (var r in ch.repos)
        if (ch.repos[r] == ch.pulls[i].repo) {
          ch.created_no[r]++;
          if (ch.pulls[i].merged && ch.pulls[i].auth)
            ch.merged_no[r]++;
        }

      // Total count
      if (ch.pulls[i].merged && ch.pulls[i].auth) {
        ch.merged++;
      } else if (ch.pulls[i].created && ch.pulls[i].auth) {
        ch.created++;
      }
    }

    // Save values
    _self.ch = ch;

    // Check if current user joined challenge
    if (uid) _self.user.joined = false;
    if (uid && ch.users.indexOf(req.session.auth.github.user.login) > -1)
      _self.user.joined = true;

    if (req.path.substring(req.path.lastIndexOf('/')) == '/users') {
      Users.find({'user_name': {$in: _self.ch.users}}).exec(gotPeople);
    } else {
      renderPage();
    }
  }

  function gotPeople(err, people) {
    _self.people = people;

    renderPage();
  }

  function renderPage() {
    res.render('challenge', {
      user:       _self.user,
      currentUrl: req.path,
      challenge:  _self.ch,
      pulls:      _self.ch.pulls,
      people:     _self.people
    });
  }
};

/*
Add new challenge. Only superuser should be able to
do this.
*/
exports.admin = function(req, res) {
  if (req.session.auth.github.user.login != 'dev_user')
    return res.redirect('/');

  var uid = ((req.session.auth) ? req.session.auth.github.user.id : null);

  Users.findOne({'user_id': uid}).exec(gotUser);

  function gotUser(err, user) {
    res.render('challenge_add', {
      title: 'New challenge',
      user: user
    });
  }

};

/*
Add info from form to db.
Only superuser can add challenges.
*/
exports.add = function(req, res) {
  if (req.session.auth.github.user.login != 'dev_user')
    return res.redirect('/');

  // Add all admins in list even if they do not exist
  new Challenges({
    name:         req.body.name,
    link:         req.body.name.replace(/\s+/g, ''),
    description:  req.body.description,
    admins:       req.body.admins.split(' ')
  }).save(savedChallenge);

  function savedChallenge(err, todo, count) {
    console.log("* Challenge " + req.body.name + " saved.");
    res.redirect('/challenges');
  }
};

/*
Edit challenge info and redirect to new link.
Redirect if user not in admin list
*/
exports.edit = function(req, res) {

  Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);

  function gotChallenge(err, ch) {
    // Check if user is admin
    if (ch.admins.indexOf(req.session.auth.github.user.login) < 0)
      return res.redirect('/challenges/' + req.params.ch);

    // Check if no repos specified (remove empty string)
    var split = [];
    if (req.body.repos == "") req.body.repos = null;
    else split = req.body.repos.split(' ');

    // Update challenge info
    var pattern = /(\d{2})\/(\d{2})\/(\d{4})/;
    var conditions = {'link': req.params.ch};
    var update = {
      $addToSet: {'repos': {$each: split}},
      $set: {
        'name':        req.body.name,
        'status':      req.body.status,
        'link':        req.body.name.replace(/\s+/g, ''),
        'email':       req.body.email,
        'logo':        req.body.logo,
        'about':       req.body.about,
        'description': req.body.description,
        'start':       new Date(req.body.start.replace(pattern, '$3-$2-$1')),
        'end':         new Date(req.body.end.replace(pattern, '$3-$2-$1'))
    }};
    Challenges.update(conditions, update, function (err, num) {
      console.log("* Owner made changes to challenge " + req.body.name);
      res.redirect('/challenges/' + req.body.name.replace(/\s+/g, '') + '/admin');
    });
  }
};

/*
Join challenge.
*/
exports.join = function(req, res) {

  Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);

  function gotChallenge(err, ch) {
    var conditions = {'link': req.params.ch};
    var update = {$addToSet: {'users': req.session.auth.github.user.login}};
    Challenges.update(conditions, update, function (err, num) {
      res.redirect('/challenges/' + req.params.ch);
    });
  }
};

/*
Add new admin to list.
Only admins can add other admins.
*/
exports.admin_add = function(req, res) {

  Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);

  function gotChallenge(err, ch) {
    // Check if user is admin
    if (ch.admins.indexOf(req.session.auth.github.user.login) < 0)
      return res.redirect('/challenges/' + req.params.ch);

    var conditions = {'link': req.params.ch};
    var update = {$addToSet: {'admins': req.body.admin}};
    Challenges.update(conditions, update, function (err, num) {
      console.log("* New admin added to " + req.body.name);
      res.redirect('/challenges/' + req.params.ch + '/admin');
    });
  }
};

/*
Remove admin. Only admins can remove other admins.
An admin can remove himself.
*/
exports.admin_remove = function(req, res) {

  Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);

  function gotChallenge(err, ch) {
    // Check if user is admin
    if (ch.admins.indexOf(req.session.auth.github.user.login) < 0)
      return res.redirect('/challenges/' + req.params.ch);

    var conditions = {'link': req.params.ch};
    var update = {$pull: {'admins': req.query.name}};
    Challenges.update(conditions, update, function (err, num) {
      console.log("* Admin removed from " + req.body.name);
      res.redirect('/challenges/' + req.params.ch + '/admin');
    });
  }
};

/*
Refresh pull requests for certain repo.
*/
exports.refresh = function(req, res) {

  Challenges.findOne({'link': req.params.ch}).exec(gotChallenge);

  function gotChallenge(err, ch) {
    if (!ch || !ch.start) return res.redirect('/challenges');

    var options = {
      host: "api.github.com",
      path: "/repos/" + ch.repos[1] + "/pulls?state=all",
      method: "GET",
      headers: { "User-Agent": "github-connect" }
    };

    var request = https.request(options, function(response){
      var body = '';
      response.on("data", function(chunk){ body+=chunk.toString("utf8"); });
      response.on("end", function(){
        var pulls = JSON.parse(body);

        for (var p in pulls) {
          // Accept only pulls created after challenge start date, before end
          // date and only from registered users
          if (new Date(pulls[p].created_at).getTime() > ch.start.getTime() &&
              new Date(pulls[p].created_at).getTime() < ch.end.getTime() &&
              ch.users.indexOf(pulls[p].user.login) > -1) {

            // Check if merge date exists
            var merge_date;

            if (!pulls[p].merged_at) merge_date = null;
            else merge_date = new Date(pulls[p].merged_at);

            var update = {$addToSet: { 'pulls': {
              repo:      ch.repos[1],
              auth:      pulls[p].user.login,
              url:       pulls[p].html_url,
              title:     pulls[p].title,
              created:   new Date(pulls[p].created_at),
              merged:    merge_date
            }}};

            Challenges.update({'link': req.params.ch}, update).exec();
          }
        }
        //console.log(pulls);

      });
    });
    request.end();
    res.redirect('/challenges/' + ch.link);
  }
};