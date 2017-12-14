"use strict";

require("dotenv").config();

const router = require("express").Router();
const debug = require("debug")("bot-express:service");
const request = require("request");
const session = require("express-session");
const api_version = "v2.1";
Promise = require("bluebird");
Promise.promisifyAll(request);

/**
@class
@prop {String} channel_id - LINE Channel Id
@prop {String} channel_secret - LINE Channel secret
@prop {String} callback_url - LINE Callback URL
@prop {String} scope - Permission to ask user to approve. Supported values are "profile" and "openid".
@prop {string} bot_prompt - Flag to switch how Bot Prompt is displayed after authentication. Supported values are "normal" and "aggressive".
@prop {Object} session_options - Option object for express-session. Refer to https://github.com/expressjs/session for detail.
*/
class ServiceLineLogin {
    /**
    @constructor
    @param {Object} options
    @param {String} options.channel_id - LINE Channel Id
    @param {String} options.channel_secret - LINE Channel secret
    @param {String} options.callback_url - LINE Callback URL
    @param {String} [options.scope="profile openid"] - Permission to ask user to approve. Supported values are "profile" and "openid".
    @param {string} [options.bot_prompt="normal"] - Flag to switch how Bot Prompt is displayed after authentication. Supported values are "normal" and "aggressive".
    @param {Object} [options.session_options] - Option object for express-session. Refer to https://github.com/expressjs/session for detail.
    */
    constructor(options){
        this.channel_id = options.channel_id;
        this.channel_secret = options.channel_secret;
        this.callback_url = options.callback_url;
        this.scope = options.scope || "profile openid";
        this.bot_prompt = options.bot_prompt || "normal";
        this.session_options = options.session_options || {
            secret: options.channel_secret,
            resave: false,
            saveUninitialized: true
        }
        router.use(session(this.session_options));
    }

    /**
    Middlware to initiate OAuth2 flow by redirecting user to LINE authorization endpoint.
    Mount this middleware to the path you like to initiate authorization.
    @method
    @param {String} [nonce] - String to prevent reply attack.
    */
    auth(nonce){
        router.get("/", (req, res, next) => {
            const client_id = encodeURIComponent(this.channel_id);
            const redirect_uri = encodeURIComponent(this.callback_url);
            const scope = encodeURIComponent(this.scope);
            const bot_prompt = encodeURIComponent(this.bot_prompt);
            const state = req.session.line_login_state = encodeURIComponent(ServiceLineLogin._generate_state());
            let url = `https://access.line.me/oauth2/${api_version}/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}&scope=${scope}&bot_prompt=${bot_prompt}&state=${state}`;
            if (nonce) url += encodeURIComponent(nonce);
            debug(`Redirecting to ${url}.`);
            return res.redirect(url);
        });
        return router;
    }

    /**
    Middleware to handle callback after authorization.
    Mount this middleware to the path corresponding to the value of Callback URL in LINE Developers Console.
    @method
    @param {Function} s - Callback function on success.
    @param {Function} f - Callback function on failure.
    */
    callback(s, f){
        router.get("/callback", (req, res, next) => {
            const code = req.query.code;
            const state = req.query.state;
            const friendship_status_changed = req.query.friendship_status_changed;

            if (!code){
                debug("Authorization failed.");
                return f(new Error("Authorization failed."));
            }
            if (req.session.line_login_state !== state){
                debug("Authorization failed. State does not match.");
                return f(new Error("Authorization failed. State does not match."));
            }
            debug("Authorization succeeded.");

            this._get_access_token(code).then((response) => {
                s(req, res, next, response);
            }).catch((error) => {
                debug(error);
                if (f) return f(req, res, next, error);
                throw(error);
            });
        });
        return router;
    }

    _get_access_token(code){
        const url = `https://api.line.me/oauth2/${api_version}/token`;
        const form = {
            grant_type: "authorization_code",
            code: code,
            redirect_uri: this.callback_url,
            client_id: this.channel_id,
            client_secret: this.channel_secret
        }
        return request.postAsync({
            url: url,
            form: form
        }).then((response) => {
            if (response.statusCode == 200){
                return response.body;
            }
            return Promise.reject(new Error(response.statusMessage));
        });
    }

    static _generate_state(){
        let max = 999999999;
        let min = 100000000;
        return Math.floor(Math.random() * (max - min + 1) ) + min;
    }
}

module.exports = ServiceLineLogin;
