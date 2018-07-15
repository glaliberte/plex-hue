const express = require('express');
const app = express();

const multer = require('multer');
const upload = multer();

const nodeHue = require('node-hue-api');
const HueApi = nodeHue.HueApi;
const HueLightState = nodeHue.lightState;

const hue_hostname = '192.168.1.40';
const hue_username = 'insert_hue_api_key_here';

const hue = new HueApi(hue_hostname, hue_username);

const LightStateOff = HueLightState.create().off();
const LightStateOn = HueLightState.create().on().brightness( 100 );
const LightStateDim = HueLightState.create().on().brightness( 33 );

let group_id = null;
let affected_lights = [];

const affected_plex_users = [ 'plex_username' ];
const affected_plex_stations = [ 'plex_player_uuid' ];
const affected_hue_groups = [ 'hue_group_name' ];

let current_play_session = null;
let play_session_changed = false;
let currently_affected_lights = [];

hue.groups().then( ( groups ) => {

    if( ! groups )
    {
        return false;
    }

    groups.forEach( ( group ) => {

        if( ! group || typeof group.name === 'undefined' )
        {
            return true;
        }

        if( group.name === 'Plex Home Theater' )
        {
            group_id = group.id;
            return false;
        }

    } );

    if( group_id !== null )
    {
        get_affected_lights();
    }
    else
    {
        create_group();
    }

} );

function create_group() {

    hue.groups().then( ( groups ) => {

        if( ! groups )
        {
            return false;
        }

        groups.forEach( ( group ) => {

            if( ! group || typeof group.name === 'undefined' )
            {
                return true;
            }

            if( affected_hue_groups.indexOf( group.name ) > -1 )
            {
                group.lights.forEach( ( light_id ) => {

                    if( affected_lights.indexOf( light_id ) === -1 )
                    {
                        affected_lights.push( light_id );
                    }

                } );
            }

        } );

        if( affected_lights.length < 1 )
        {
            console.log( 'No light has been found for Plex group.' );
            return;
        }

        hue.createGroup( 'Plex Home Theater', affected_lights ).then( ( group ) => {

            if( group && group.id )
            {
                group_id = group.id;
                listen();
            }
            else
            {
                console.log( "Unable to create group of lights for Plex." );
            }

        } );

    } ).done();

}

function get_affected_lights() {

    hue.getGroup( group_id ).then( ( group ) => {

        if( ! group || typeof group.lights === 'undefined' )
        {
            console.error( "Unable to find Plex Home Theater group lights" );
            return;
        }

        group.lights.forEach( ( light_id ) => {

            if( affected_lights.indexOf( light_id ) === -1 )
            {
                affected_lights.push( light_id );
            }

        } );

        if( affected_lights.length < 1 )
        {
            console.error( "No light has been found in Plex group." );
            return;
        }

        listen();

    } );

}

function listen() {

    app.listen(3042, function () {
        console.log('Plex Hue waiting on port 3042');
    });

}

app.post('/webhook', upload.single( 'thumb' ), function (req, res, next) {

    let payload = req.body;

    if( ! payload )
    {
        return;
    }

    if( typeof payload.payload === 'undefined' )
    {
        return;
    }

    payload = payload.payload;

    try
    {
        payload = JSON.parse( payload );
    }
    catch( err )
    {
        return;
    }

    console.log( `User: ${payload.Account.title}` );
    console.log( `Player: ${payload.Player.title} (${payload.Player.uuid})` );

    if( ! checkUserAccount( payload ) )
    {
        return;
    }

    if( ! checkPlexStation( payload ) )
    {
        return;
    }

    if( ! checkMedia( payload ) )
    {
        return;
    }

    let light_state = null;
    let light_state_description = null;

    let payload_play_session = getPlaySession( payload );
    play_session_changed = payload_play_session !== current_play_session;

    if( play_session_changed )
    {
        current_play_session = payload_play_session;
    }

    getCurrentlyAffectedLights( ( has_lights ) => {

        switch( payload.event )
        {

            case 'media.play':
            case 'media.resume':

                light_state = LightStateOff;

                if( payload.event === 'media.play' )
                {
                    light_state_description = 'Playback has started: ';
                }
                else
                {
                    light_state_description = 'Playback has resumed: ';
                }

                light_state_description += 'lights have been turned off';

                break;
            case 'media.stop':

                light_state = LightStateOn;
                light_state_description = 'Playback has stopped: lights have been turned on';

                current_play_session = null;

                break;
            case 'media.pause':

                light_state = LightStateDim;
                light_state_description = 'Playback has paused: lights have been dimmed';

                break;

        }

        if( ! has_lights || light_state === null )
        {
            return;
        }

        currently_affected_lights.forEach( ( light_id ) => {

            hue.setLightState( light_id, light_state ).then( ( response ) => {

                if( response )
                {
                    console.log( light_state_description );
                }
                else
                {
                    console.error( 'An error occurred and state could not been changed on lights' );
                }

            } ).done();

        } );

    } );



    res.send( 'OK' );

});

function checkUserAccount( payload ) {

    if( typeof payload.Account === 'undefined' || typeof payload.Account.title === 'undefined' )
    {
        return false;
    }
    else
    {
        return affected_plex_users.indexOf( payload.Account.title ) > -1;
    }

}

function checkPlexStation( payload ) {

    if( typeof payload.Player === 'undefined' || typeof payload.Player.uuid === 'undefined' )
    {
        return false;
    }
    else
    {
        return affected_plex_stations.indexOf( payload.Player.uuid ) > -1;
    }

}

function checkMedia( payload ) {

    if( typeof payload.Metadata === 'undefined' || typeof payload.Metadata.type === 'undefined' )
    {
        return false;
    }

    return payload.Metadata.type !== 'track';

}

function getPlaySession( payload ) {

    if( typeof payload.Metadata === 'undefined' || typeof payload.Metadata.key === 'undefined'  )
    {
        return false;
    }

    return payload.Metadata.key;

}

function getCurrentlyAffectedLights( callback ) {

    if( play_session_changed )
    {
        let lights_checked = 0;

        currently_affected_lights = [];

        affected_lights.forEach( ( light_id ) => {

            hue.lightStatus( light_id ).then( ( status ) => {

                if( status && typeof status.state !== 'undefined' )
                {
                    if( typeof status.state.on !== 'undefined' && status.state.on )
                    {
                        currently_affected_lights.push( light_id );
                    }
                }

                lights_checked++;

                if( lights_checked >= affected_lights.length )
                {
                    callback( currently_affected_lights.length > 0 );
                }

            } ).done();

        } );
    }
    else
    {
        callback( currently_affected_lights.length > 0 );
    }

}