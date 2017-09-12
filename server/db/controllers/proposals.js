/**
 * Created by oriharel on 31/05/2016.
 */
import _ from 'lodash';
import Proposal from '../models/proposal';
import User from '../models/user';
import {transformProposal, transformUser} from './helpers';
import shuffler from 'shuffle-seed';
import request from 'axios';

/**
 * List
 */
export function all(req, res) {
  Proposal.find({ status: { $ne: 'archived' } }, null, { sort: { created_at: -1 } }).populate('speaker_ids').exec((err, proposals) => {
    if (err) {
      console.log(`Error in proposals/all query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    }

    let result = proposals.map((proposal) => transformProposal(proposal, req.user, req.query && req.query.overrideDetails === 'true'));

    if (req.query.group === 'tags') {
      let groups = {};

      result.forEach(proposal => {
        if (proposal.tags === undefined || proposal.tags.length === 0) {
          groups['Untagged'] = groups['Untagged'] || [];
          groups['Untagged'].push(proposal);
        } else {
          proposal.tags.forEach(tag => {
            groups[tag] = groups[tag] || [];
            groups[tag].push(proposal);
          });
        }
      });

      result = groups;
    }

    const shuffleSeed = (req.user && req.user.id) ? req.user.id : String(Date.now());
    console.log("seed", shuffleSeed);
    return res.json(shuffler.shuffle(result, shuffleSeed));
  });
}

/**
 * Recommendations
 */
const totalRecommendations = 3;
const randomRecommendations = 2;

export function getRecommendations(req, res) {
  let onlyAcceptedProposals = {};

  if (req.query.onlyAccepted) {
    onlyAcceptedProposals = { status: 'accepted' }
  }

  Proposal.findOne({ 'id': req.params.id }).exec()
    .catch(err => {
      console.log(`Error in recommendations/first query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    })
    .then(proposal => {
      let totalIntersectedTags = Math.min(totalRecommendations - randomRecommendations, proposal.tags.length);
      let intersectedTags = _.take(_.shuffle(proposal.tags), totalIntersectedTags);

      let query = {
        id: { '$ne': proposal.id },
        status: { $ne: 'archived' },
        tags: {
          '$elemMatch': {
            '$in': intersectedTags
          }
        }
      };
      if (req.session.passport && req.session.passport.user) {
        query['speaker_ids'] = {
          '$elemMatch': {
            '$ne': req.session.passport.user
          }
        }
      }

      return Proposal.find(Object.assign({}, query, onlyAcceptedProposals)).populate('speaker_ids').limit(totalRecommendations - randomRecommendations).exec();
    })
    .catch(err => {
      console.log(`Error in recommendations/second query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    })
    .then(recommendations => {
      let query = {
        id: {
          '$nin': [
            req.params.id,
            ...recommendations.map(r => r.id)
          ]
        },
        status: { $ne: 'archived' }
      };
      if (req.session.passport && req.session.passport.user) {
        query['speaker_ids'] = {
          '$elemMatch': {
            '$ne': req.session.passport.user
          }
        }
      }

      Proposal.find(Object.assign({}, query, onlyAcceptedProposals)).populate('speaker_ids').exec().then(randomRecommendations => {
        return _.shuffle([
          ...recommendations,
          ..._.take(_.shuffle(randomRecommendations), totalRecommendations - recommendations.length)
        ]);
      }).then(recs => {
        return res.json(recs.map(proposal => transformProposal(proposal, req.user)));
      });
    });
}

/**
 * Tags List
 */
export function tags(req, res) {
  Proposal.aggregate([
    { $project: { tags: 1 } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags" } }
  ]).exec().then(tags => {
    return res.json(tags.filter(tag => !!tag._id).map(tag => tag._id).sort());
  }).catch(err => {
    console.log(`Error in proposals/tags query: ${err}`);
    return res.status(500).send('Something went wrong getting the data');
  });
}

/**
 * Single Proposal
 */
export function get(req, res) {
  Proposal.findOne({'id': req.params.id}).populate('speaker_ids').exec((err, proposal) => {
    if (err) {
      console.log(`Error in proposals/get query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    }

    return res.json(transformProposal(proposal, req.user));
  });
}

/**
 * Add a Proposal
 */
export function add(req, res) {
  let proposal = _.clone(req.body);

  proposal.created_at = new Date();
  proposal.updated_at = new Date();

  console.log('adding new proposal ' + JSON.stringify(proposal));

  Proposal.create(proposal, (err, model) => {
    if (err) {
      console.log(`Error in proposals/add query: ${err}`);
      return res.status(500).send('Something went wrong');
    }

    // Update speakers proposals
    proposal.speaker_ids.forEach(speaker_id => {
      User.findByIdAndUpdate(
        speaker_id,
        { $push: {'proposals': model._id} },
        { safe: true, upsert: true },
        (err, model) => {
          if (err) {
            console.log(`Error in proposals/add/updateUser query: ${err}`);
            return res.status(500).send('Something went wrong');
          }
        }
      );
    });

    Promise.all(proposal.speaker_ids.map(speaker_id => {
      return User.findOne({ _id: speaker_id });
    })).then(speakers => {

      const authorName = speakers.map(speaker => speaker.profile.name).join(" & ");
      request({
        url: process.env.SLACK_URL,
        method: "POST",
        data: {
          username: "CFP Alert",
          text: `${authorName} submitted: ${proposal.title}`,
          channel: process.env.NODE_ENV === 'production' ? "#cfp" : null,
          attachments: [
            {
              title: proposal.title,
              author_name: authorName,
              author_link: `https://summit2017.reversim.com/session/${proposal.id}`,
              author_icon: speakers[0].profile.picture,
              text: speakers[0].email
            },
            {
              "title": "tags",
              "color": "#ef6c00",
              "text": proposal.tags ? proposal.tags.join(", ") : ""
            },
            {
              text: proposal.abstract,
              color: "#0073cf"
            }
          ]
        }
      });
    });

    return res.status(200).send('OK');
  });
}

/**
 * Update a proposal
 */
export function update(req, res) {
  const omitKeys = ['id', '_id', '_v'];
  req.body.updated_at = new Date();
  const data = _.omit(req.body, omitKeys);

  Proposal.findOneAndUpdate({ id: req.params.id }, data, (err, obj) => {
    if (err) {
      console.log(`Error in proposals/update query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    }

    return res.status(200).send('Updated successfully');
  });
}

/**
 * Remove a proposal
 */
export function remove(req, res) {
  const query = { id: req.params.id };
  console.log('removing proposal '+JSON.stringify(query));
  Proposal.findOneAndRemove(query, (err) => {
    if (err) {
      console.log(`Error in proposals/remove query: ${err}`);
      return res.status(500).send('Something went wrong');
    }

    return res.status(200).send('Removed Successfully');
  });
}

/**
 * Attend a proposal
 */
export function attend(req, res) {
  if (req.session.passport && req.session.passport.user) {
    let query, update;
    if (req.body.value === true) {
      query = { id: req.params.id, status: { $ne: 'archived' }, attendees: { $nin: [req.session.passport.user] } };
      update = { $push: {'attendees': req.session.passport.user } };
    } else {
      query = { id: req.params.id, status: { $ne: 'archived' }, attendees: { $in: [req.session.passport.user] } };
      update = { $pull: {'attendees': req.session.passport.user} };
    }

    Proposal.findOneAndUpdate(query, update, (err, obj) => {
      if (err) {
        console.log(`Error in proposals/attend query: ${err}`);
        return res.status(500).send('Something went wrong getting the data');
      }

      return res.status(200).send('Marked as attended');
    });
  } else {
    return res.status(403).send('Unauthorized');
  }
}

/**
 * Get Speakers
 */
export function speakers(req, res) {
  Proposal.find({ status: 'accepted' }, null, { sort: { created_at: -1 } }).populate('speaker_ids').exec((err, proposals) => {
    if (err) {
      console.log(`Error in proposals/speakers query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    }

    let result = _.uniq(_.flatMap(proposals, proposal => proposal.speaker_ids), '_id').map(u => transformUser(u, req.user));

    return res.json(result);
  });
}

export function sessions(req, res) {
  Proposal.find({ status: 'accepted' }).populate('speaker_ids').exec((err, proposals) => {
    if (err) {
      console.log(`Error in proposals/speakers query: ${err}`);
      return res.status(500).send('Something went wrong getting the data');
    }

    return res.json(proposals.map(p => transformProposal(p, req.user)));
  });
}

const baseQuery = [
  {$unwind: "$speaker_ids"},
  {$lookup: {
    localField: "speaker_ids",
    from: "users",
    foreignField: "_id",
    as: "speaker"
  }},
  {$unwind: "$speaker"},
  {$unwind: "$attendees"},
  {$lookup: {
    localField: "attendees",
    from: "users",
    foreignField: "_id",
    as: "attendee"
  }},
  {$unwind: "$attendee"},
  {$group: {
    _id: "$id",
    link: {
      $first: {
        $concat: ["https://summit2017.reversim.com/session/", "$id"]
      }
    },
    title: { $first: "$title" },
    speaker: { $first: "$speaker.profile.name" },
    attendees: {
      $push: { $concat: ["$attendee.profile.name", " <", "$attendee.email", ">"] }
    },
    attendeeCount: { $sum: 1 }
  }}
];

const projectAttendeesRaw = { $project: {
  attendeeCount: 1,
  link: 1,
  title: 1,
  speaker: 1,
  attendees: 1
}};
const projectAttendees = { $project: {
  attendeeCount: 1,
  link: 1,
  title: 1,
  speaker: 1
}};
const sortAttendees = { $sort: { attendeeCount: -1 }};

const aggregateQuery = (isDataAdmin) => {
  if (isDataAdmin) {
    return baseQuery.concat([
      projectAttendeesRaw, sortAttendees
    ]);
  } else {
    return baseQuery.concat([
      projectAttendees,
      sortAttendees
    ]);
  }
};

const attendDataQuery = [
  { $unwind: "$attendees" },
  { $group: {
    _id: "$attendees",
    totalPerVoter: {
      $sum: 1
    }
  }},
  { $group: {
    _id: null,
    uniqueVoters: {
      $sum: 1
    },
    averagePerVoter: {
      $avg: "$totalPerVoter"
    },
    totalVotes: {
      $sum: "$totalPerVoter"
    }
  }}
];

export function getAllAttendees(req, res) {
  if (!req.user || !req.user.isReversimTeamMember) {
    return res.send(401);
  }

  let query;
  if (req.user.isDataAdmin) {
    query = aggregateQuery(true);
  } else if (req.user.isReversimTeamMember) {
    query = aggregateQuery(false);
  }

  Promise.all([
    Proposal.aggregate(query).exec(),
    Proposal.aggregate(attendDataQuery).exec()
  ]).then(([proposals, data]) => {
    return res.json({ proposals, data: data[0] });
  }).catch(err => {
    console.log(`Error in proposal/attendees query: ${err}`);
    return res.status(500).send('Something went wrong getting the data');
  });
}

export default {
  all,
  get,
  add,
  update,
  remove,
  attend,
  tags,
  getRecommendations,
  speakers,
  sessions,
  getAllAttendees
};
